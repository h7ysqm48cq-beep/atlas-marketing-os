from __future__ import annotations

from importlib import import_module
import subprocess


def assignment(
    *,
    purpose: str = "IMPLEMENTATION",
    objective: str = "把 UsersService 改成 AccountsService",
    allowed_paths: list[str] | None = None,
    forbidden_actions: list[str] | None = None,
) -> dict:
    return {
        "executionPurpose": purpose,
        "objective": objective,
        "allowedPaths": allowed_paths or ["src/users/users.service.ts"],
        "forbiddenActions": forbidden_actions or [],
        "acceptance": [],
        "requiredEvidence": [],
    }


def test_refuses_independent_verification_assignment(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)
    result = executor.execute(
        assignment(purpose="INDEPENDENT_VERIFICATION"),
        allow_apply=True,
    )

    assert not result.success
    assert result.error == "supervisor_execution_purpose_not_supported"


def write_users_service(tmp_path):
    target = tmp_path / "src/users/users.service.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "export class UsersService {}\n",
        encoding="utf-8",
    )
    return target


def test_ambiguous_objective_stays_planning_only(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    target = write_users_service(tmp_path)
    before = target.read_text(encoding="utf-8")
    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)

    result = executor.execute(
        assignment(objective="重新设计 Dashboard，手机版也优化"),
        allow_apply=True,
    )

    assert not result.success
    assert result.error == "supervisor_objective_requires_review"
    assert result.planning is not None
    assert result.planning["requiresReview"] is True
    assert target.read_text(encoding="utf-8") == before


def test_refuses_planned_path_outside_allowed_scope(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    target = write_users_service(tmp_path)
    before = target.read_text(encoding="utf-8")
    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)

    result = executor.execute(
        assignment(allowed_paths=["src/other.ts"]),
        allow_apply=True,
    )

    assert not result.success
    assert result.error == "supervisor_scope_violation"
    assert result.planning is not None
    assert result.planning["operation"] == "rename_symbol"
    assert result.planning["plannedPaths"] == [
        "src/users/users.service.ts"
    ]
    assert target.read_text(encoding="utf-8") == before


def test_refuses_explicitly_forbidden_operation(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    target = write_users_service(tmp_path)
    before = target.read_text(encoding="utf-8")
    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)

    result = executor.execute(
        assignment(forbidden_actions=["rename_symbol"]),
        allow_apply=True,
    )

    assert not result.success
    assert result.error == "supervisor_forbidden_action"
    assert target.read_text(encoding="utf-8") == before


def test_rejects_allowed_path_traversal(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)

    result = executor.execute(
        assignment(allowed_paths=["../src/users/users.service.ts"]),
        allow_apply=True,
    )

    assert not result.success
    assert result.error == "supervisor_allowed_path_invalid"


def test_plan_does_not_grant_apply_authority(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    target = write_users_service(tmp_path)
    before = target.read_text(encoding="utf-8")
    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)

    result = executor.execute(
        assignment(),
        allow_apply=False,
    )

    assert not result.success
    assert result.error == "supervisor_apply_not_authorized"
    assert result.planning is not None
    assert result.planning["operation"] == "rename_symbol"
    assert target.read_text(encoding="utf-8") == before


def init_git_repo(tmp_path):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "atlas-test@example.com"],
        cwd=tmp_path,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Atlas Test"],
        cwd=tmp_path,
        check=True,
    )
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "commit", "-qm", "baseline"],
        cwd=tmp_path,
        check=True,
    )


def test_allowed_rename_applies_and_returns_supervisor_evidence(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    target = write_users_service(tmp_path)
    init_git_repo(tmp_path)
    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)

    result = executor.execute(assignment(), allow_apply=True)

    assert result.success
    assert result.error is None
    assert result.planning is not None
    assert result.planning["operation"] == "rename_symbol"
    assert result.evidence["changedFiles"] == [
        "src/users/users.service.ts"
    ]
    assert result.evidence["deploymentState"] == "NOT_DEPLOYED"
    assert result.evidence["gitState"] == "MODIFIED"
    assert result.evidence["tests"] == []
    assert result.evidence["build"] == "NOT_RUN"
    assert "tests_not_run" in result.evidence["remainingRisk"]
    assert "build_not_run" in result.evidence["remainingRisk"]

    output = target.read_text(encoding="utf-8")
    assert "UsersService" not in output
    assert "AccountsService" in output


def test_post_apply_scope_drift_rolls_back_workspace(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    ai_module = import_module("tools.ai_engineer")
    request_module = import_module("tools.ai_engineer.request")
    target = write_users_service(tmp_path)
    init_git_repo(tmp_path)
    delegate = ai_module.build_natural_language_engineer()

    class DriftEngineer:
        def handle(self, *args, **kwargs):
            result = delegate.handle(*args, **kwargs)
            if kwargs.get("mode") == request_module.AIEngineerMode.APPLY:
                (tmp_path / "outside.txt").write_text("drift\n", encoding="utf-8")
            return result

    executor = module.SupervisorAssignmentExecutor(
        project_root=tmp_path,
        engineer=DriftEngineer(),
    )
    result = executor.execute(assignment(), allow_apply=True)

    assert not result.success
    assert result.error == "supervisor_post_apply_scope_drift"
    assert "UsersService" in target.read_text(encoding="utf-8")
    assert not (tmp_path / "outside.txt").exists()
    assert git_changed_files(tmp_path) == []


def git_changed_files(tmp_path):
    tracked = subprocess.run(
        ["git", "diff", "--name-only", "HEAD", "--"],
        cwd=tmp_path,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.splitlines()
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        cwd=tmp_path,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.splitlines()
    return sorted({*tracked, *untracked})


def test_refuses_dirty_workspace_before_apply(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    target = write_users_service(tmp_path)
    init_git_repo(tmp_path)
    (tmp_path / "preexisting.txt").write_text("dirty\n", encoding="utf-8")
    before = target.read_text(encoding="utf-8")
    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)

    result = executor.execute(assignment(), allow_apply=True)

    assert not result.success
    assert result.error == "supervisor_workspace_not_clean"
    assert target.read_text(encoding="utf-8") == before
    assert git_changed_files(tmp_path) == ["preexisting.txt"]


def test_runtime_failure_rolls_back_partial_mutation(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    ai_module = import_module("tools.ai_engineer")
    request_module = import_module("tools.ai_engineer.request")
    from types import SimpleNamespace

    target = write_users_service(tmp_path)
    init_git_repo(tmp_path)
    delegate = ai_module.build_natural_language_engineer()

    class PartialFailureEngineer:
        def handle(self, *args, **kwargs):
            if kwargs.get("mode") == request_module.AIEngineerMode.APPLY:
                target.write_text("BROKEN\n", encoding="utf-8")
                return SimpleNamespace(success=False)
            return delegate.handle(*args, **kwargs)

    executor = module.SupervisorAssignmentExecutor(
        project_root=tmp_path,
        engineer=PartialFailureEngineer(),
    )
    result = executor.execute(assignment(), allow_apply=True)

    assert not result.success
    assert result.error == "supervisor_apply_failed"
    assert target.read_text(encoding="utf-8") == "export class UsersService {}\n"
    assert git_changed_files(tmp_path) == []


def test_module_cli_consumes_runner_assignment_and_emits_worker_result(tmp_path):
    import json
    import os
    import sys
    from pathlib import Path

    module = import_module("tools.ai_engineer.supervisor_executor")
    repo_root = Path(module.__file__).resolve().parents[2]
    target = write_users_service(tmp_path)
    (tmp_path / "tools").mkdir(parents=True, exist_ok=True)
    os.symlink(repo_root / "tools/modifier", tmp_path / "tools/modifier")
    os.symlink(repo_root / "node_modules", tmp_path / "node_modules")
    init_git_repo(tmp_path)
    env = os.environ.copy()
    env["PYTHONPATH"] = str(repo_root)

    completed = subprocess.run(
        [sys.executable, "-m", "tools.ai_engineer.supervisor_executor"],
        cwd=tmp_path,
        input=json.dumps(assignment()),
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )

    assert completed.returncode == 0
    payload = json.loads(completed.stdout)
    assert set(payload) == {"summary", "evidence"}
    assert payload["evidence"]["changedFiles"] == ["src/users/users.service.ts"]
    assert completed.stderr == ""
    assert "AccountsService" in target.read_text(encoding="utf-8")


def test_refuses_symlink_target_that_escapes_project_root(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    outside = tmp_path.parent / f"{tmp_path.name}-outside.ts"
    outside.write_text("export class UsersService {}\n", encoding="utf-8")
    target = tmp_path / "src/users/users.service.ts"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(outside)
    init_git_repo(tmp_path)
    before = outside.read_text(encoding="utf-8")

    executor = module.SupervisorAssignmentExecutor(project_root=tmp_path)
    result = executor.execute(assignment(), allow_apply=True)

    assert not result.success
    assert result.error == "supervisor_target_path_invalid"
    assert outside.read_text(encoding="utf-8") == before
    assert git_changed_files(tmp_path) == []
    outside.unlink()


def test_scope_drift_symlink_is_removed_during_rollback(tmp_path):
    module = import_module("tools.ai_engineer.supervisor_executor")
    ai_module = import_module("tools.ai_engineer")
    request_module = import_module("tools.ai_engineer.request")
    write_users_service(tmp_path)
    init_git_repo(tmp_path)
    outside = tmp_path.parent / f"{tmp_path.name}-external.txt"
    outside.write_text("external\n", encoding="utf-8")
    delegate = ai_module.build_natural_language_engineer()

    class SymlinkDriftEngineer:
        def handle(self, *args, **kwargs):
            result = delegate.handle(*args, **kwargs)
            if kwargs.get("mode") == request_module.AIEngineerMode.APPLY:
                (tmp_path / "escape-link").symlink_to(outside)
            return result

    executor = module.SupervisorAssignmentExecutor(
        project_root=tmp_path,
        engineer=SymlinkDriftEngineer(),
    )
    result = executor.execute(assignment(), allow_apply=True)

    assert not result.success
    assert result.error == "supervisor_post_apply_scope_drift"
    assert not (tmp_path / "escape-link").exists()
    assert outside.read_text(encoding="utf-8") == "external\n"
    assert git_changed_files(tmp_path) == []
    outside.unlink()
