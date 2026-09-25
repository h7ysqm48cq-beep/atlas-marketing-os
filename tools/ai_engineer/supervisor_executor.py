from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import subprocess
import sys
from typing import Any, Mapping

if __package__:
    from .natural_language import build_natural_language_engineer
    from .request import AIEngineerMode
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tools.ai_engineer.natural_language import build_natural_language_engineer
    from tools.ai_engineer.request import AIEngineerMode


@dataclass(slots=True, frozen=True)
class SupervisorExecutorResult:
    success: bool
    summary: str
    evidence: dict[str, Any]
    error: str | None = None
    planning: dict[str, Any] | None = None


def _normalize_relative_path(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ValueError("supervisor_allowed_path_invalid")
    if path.as_posix() in {".", ""}:
        raise ValueError("supervisor_allowed_path_invalid")
    return path.as_posix()


class SupervisorAssignmentExecutor:
    def __init__(
        self,
        *,
        project_root: str | Path,
        engineer: Any | None = None,
    ) -> None:
        self.project_root = Path(project_root).expanduser().resolve()
        self.engineer = engineer or build_natural_language_engineer()

    def execute(
        self,
        assignment: Mapping[str, Any],
        *,
        allow_apply: bool = False,
    ) -> SupervisorExecutorResult:
        if assignment.get("verificationMode") == "EXISTING_CANDIDATE":
            if assignment.get("candidateBaseSha") == assignment.get("candidateHeadSha"):
                return self._verify_runtime_refresh(assignment)
            return self._verify_existing_candidate(assignment)
        if assignment.get("executionPurpose", "IMPLEMENTATION") != "IMPLEMENTATION":
            return self._failure("supervisor_execution_purpose_not_supported")

        objective = assignment.get("objective")
        if not isinstance(objective, str) or not objective.strip():
            return self._failure("supervisor_objective_invalid")

        try:
            allowed = self._allowed_paths(assignment)
            self._assert_safe_allowed_targets(allowed)
        except ValueError as error:
            return self._failure(str(error))

        planned = self.engineer.handle(
            objective,
            target_project=str(self.project_root),
            mode=AIEngineerMode.PLAN,
            allow_apply=False,
        )

        if not planned.success:
            return self._failure(
                "supervisor_plan_failed",
                planning={"requiresReview": True},
            )

        if planned.engineering_plan is not None:
            return self._failure(
                "supervisor_objective_requires_review",
                planning={
                    "requiresReview": True,
                    "operation": None,
                    "plannedPaths": [],
                },
            )

        request = planned.adaptation.request if planned.adaptation else None
        if request is None:
            return self._failure(
                "supervisor_objective_requires_review",
                planning={"requiresReview": True},
            )

        operation = request.operation.value
        target_file = request.arguments.get("target_file")
        if not isinstance(target_file, str):
            return self._failure(
                "supervisor_operation_not_supported",
                planning={"requiresReview": True, "operation": operation},
            )

        planned_paths = [_normalize_relative_path(target_file)]
        planning = {
            "requiresReview": False,
            "operation": operation,
            "plannedPaths": planned_paths,
        }
        if not set(planned_paths).issubset(allowed):
            return self._failure("supervisor_scope_violation", planning=planning)
        if self._operation_forbidden(operation, assignment):
            return self._failure("supervisor_forbidden_action", planning=planning)
        if not allow_apply:
            return self._failure("supervisor_apply_not_authorized", planning=planning)

        before = self._git_changed_files()
        if before:
            return self._failure("supervisor_workspace_not_clean", planning=planning)

        applied = self.engineer.handle(
            objective,
            target_project=str(self.project_root),
            mode=AIEngineerMode.APPLY,
            allow_apply=True,
        )
        if not applied.success:
            changed = self._git_changed_files()
            self._restore_clean_workspace(changed)
            return self._failure("supervisor_apply_failed", planning=planning)

        changed = self._git_changed_files()
        if not set(changed).issubset(allowed):
            self._restore_clean_workspace(changed)
            return self._failure("supervisor_post_apply_scope_drift", planning=planning)

        return SupervisorExecutorResult(
            success=True,
            summary=f"Applied {operation} within Supervisor scope.",
            evidence=self._evidence(changed),
            planning=planning,
        )

    def _verify_runtime_refresh(
        self, assignment: Mapping[str, Any]
    ) -> SupervisorExecutorResult:
        sha = assignment.get("candidateHeadSha")
        if (
            assignment.get("executionPurpose") != "INDEPENDENT_VERIFICATION"
            or not isinstance(sha, str)
            or len(sha) != 40
            or any(c not in "0123456789abcdef" for c in sha)
            or sha != assignment.get("candidateBaseSha")
            or sha != assignment.get("productionBaselineSha")
        ):
            return self._failure("runtime_refresh_identity_invalid")
        # A same-SHA API runtime refresh has no Git changes and therefore
        # MUST have an explicit empty scope. Nonempty, missing, or malformed
        # scopes fail closed; other executor modes still require paths.
        if assignment.get("allowedPaths") != []:
            return self._failure("runtime_refresh_allowed_paths_invalid")
        try:
            head = subprocess.run(
                ["git", "rev-parse", "--verify", "HEAD"],
                cwd=self.project_root, text=True, capture_output=True, check=True,
            ).stdout.strip().lower()
            changed = self._git_changed_files()
        except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
            return self._failure(f"runtime_refresh_git_verification_failed:{error}")
        if head != sha or changed:
            return self._failure("runtime_refresh_head_or_workspace_mismatch")
        return SupervisorExecutorResult(
            success=True,
            summary="Verified clean same-SHA API runtime refresh workspace.",
            evidence={
                "rootCause": "runtime_refresh_requires_no_git_change",
                "changedFiles": [],
                "tests": ["git_head_exact", "git_worktree_clean"],
                "build": "NOT_RUN",
                "regression": [],
                "deploymentState": "NOT_DEPLOYED",
                "gitState": "CLEAN",
                "remainingRisk": ["api_build_not_run"],
            },
        )

    def _verify_existing_candidate(
        self, assignment: Mapping[str, Any]
    ) -> SupervisorExecutorResult:
        base = assignment.get("candidateBaseSha")
        head = assignment.get("candidateHeadSha")
        baseline = assignment.get("productionBaselineSha")
        if (
            assignment.get("executionPurpose") != "INDEPENDENT_VERIFICATION"
            or not all(self._is_sha(value) for value in (base, head, baseline))
            or base.lower() == head.lower()
            or base.lower() != baseline.lower()
        ):
            return self._failure("existing_candidate_identity_invalid")

        try:
            allowed = self._allowed_paths(assignment)
            self._assert_safe_allowed_targets(allowed)
            if self._git_changed_files():
                return self._failure("existing_candidate_workspace_dirty")

            resolved: dict[str, str] = {}
            for label, sha in (("base", base), ("head", head)):
                resolved[label] = subprocess.run(
                    ["git", "rev-parse", "--verify", f"{sha.lower()}^{{commit}}"],
                    cwd=self.project_root, text=True, capture_output=True, check=True,
                ).stdout.strip().lower()
                if resolved[label] != sha.lower():
                    return self._failure(f"existing_candidate_{label}_mismatch")

            subprocess.run(
                ["git", "merge-base", "--is-ancestor", base.lower(), head.lower()],
                cwd=self.project_root, text=True, capture_output=True, check=True,
            )
            raw = subprocess.run(
                [
                    "git", "diff", "--no-renames", "--no-ext-diff",
                    "--no-textconv", "--name-only", "-z",
                    base.lower(), head.lower(),
                ],
                cwd=self.project_root, text=True, capture_output=True, check=True,
            ).stdout
            changed = sorted(
                {
                    _normalize_relative_path(path)
                    for path in raw.split("\0")
                    if path
                }
            )
            if changed != sorted(allowed):
                return self._failure("existing_candidate_scope_mismatch")

            current_head = subprocess.run(
                ["git", "rev-parse", "--verify", "HEAD"],
                cwd=self.project_root, text=True, capture_output=True, check=True,
            ).stdout.strip().lower()
            if current_head != head.lower() or self._git_changed_files():
                return self._failure("existing_candidate_workspace_drift")
        except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
            return self._failure(f"existing_candidate_git_verification_failed:{error}")

        return SupervisorExecutorResult(
            success=True,
            summary="Verified exact existing candidate without repository writes.",
            evidence={
                "rootCause": (
                    "existing_candidate_requires_exact_read_only_git_verification"
                ),
                "changedFiles": changed,
                "tests": [
                    "git_base_exact", "git_head_exact", "base_is_head_ancestor",
                    "production_baseline_exact",
                    "changed_paths_exact",
                    "workspace_clean",
                ],
                "build": "NOT_RUN",
                "regression": [],
                "deploymentState": "NOT_DEPLOYED",
                "gitState": "CLEAN",
                "remainingRisk": ["verification_does_not_merge_or_deploy"],
            },
        )

    @staticmethod
    def _is_sha(value: Any) -> bool:
        return (
            isinstance(value, str)
            and len(value) == 40
            and all(character in "0123456789abcdefABCDEF" for character in value)
        )

    def _git_changed_files(self) -> list[str]:
        commands = (
            ["git", "diff", "--name-only", "HEAD", "--"],
            ["git", "ls-files", "--others", "--exclude-standard"],
        )
        changed: set[str] = set()
        for command in commands:
            completed = subprocess.run(
                command,
                cwd=self.project_root,
                text=True,
                capture_output=True,
                check=False,
            )
            if completed.returncode != 0:
                raise RuntimeError("supervisor_git_inspection_failed")
            for line in completed.stdout.splitlines():
                if line.strip():
                    changed.add(_normalize_relative_path(line))
        return sorted(changed)

    def _restore_clean_workspace(self, changed: list[str]) -> None:
        del changed
        commands = (
            ["git", "restore", "--source=HEAD", "--staged", "--worktree", "--", "."],
            ["git", "clean", "-fd"],
        )
        for command in commands:
            completed = subprocess.run(
                command,
                cwd=self.project_root,
                text=True,
                capture_output=True,
                check=False,
            )
            if completed.returncode != 0:
                raise RuntimeError("supervisor_workspace_restore_failed")


    @staticmethod
    def _evidence(changed: list[str]) -> dict[str, Any]:
        return {
            "rootCause": "bounded_ai_engineer_operation",
            "changedFiles": changed,
            "tests": [],
            "build": "NOT_RUN",
            "regression": [],
            "deploymentState": "NOT_DEPLOYED",
            "gitState": "MODIFIED" if changed else "CLEAN",
            "remainingRisk": ["tests_not_run", "build_not_run"],
        }

    @staticmethod
    def _operation_forbidden(operation: str, assignment: Mapping[str, Any]) -> bool:
        raw = assignment.get("forbiddenActions", [])
        if not isinstance(raw, list):
            return True
        normalized = {
            value.strip().lower().replace("-", "_").replace(" ", "_")
            for value in raw
            if isinstance(value, str)
        }
        return operation.lower() in normalized

    def _assert_safe_allowed_targets(self, allowed: set[str]) -> None:
        root = self.project_root
        for relative in allowed:
            candidate = root / relative
            absolute = candidate.absolute()
            resolved = candidate.resolve(strict=False)
            try:
                resolved.relative_to(root)
            except ValueError as error:
                raise ValueError("supervisor_target_path_invalid") from error
            if resolved != absolute:
                raise ValueError("supervisor_target_path_invalid")

    @staticmethod
    def _allowed_paths(assignment: Mapping[str, Any]) -> set[str]:
        raw = assignment.get("allowedPaths")
        if not isinstance(raw, list) or not raw:
            raise ValueError("supervisor_allowed_paths_invalid")
        normalized: set[str] = set()
        for value in raw:
            if not isinstance(value, str):
                raise ValueError("supervisor_allowed_paths_invalid")
            normalized.add(_normalize_relative_path(value))
        return normalized

    @staticmethod
    def _failure(
        error: str,
        *,
        planning: dict[str, Any] | None = None,
    ) -> SupervisorExecutorResult:
        return SupervisorExecutorResult(
            success=False,
            summary="Supervisor assignment refused.",
            evidence={},
            error=error,
            planning=planning,
        )


def main() -> None:
    import contextlib
    import io
    import json
    import sys

    try:
        assignment = json.load(sys.stdin)
        if not isinstance(assignment, dict):
            raise ValueError("supervisor_assignment_invalid")

        diagnostics = io.StringIO()
        with contextlib.redirect_stdout(diagnostics):
            result = SupervisorAssignmentExecutor(
                project_root=Path.cwd(),
            ).execute(
                assignment,
                allow_apply=True,
            )

        if not result.success:
            sys.stderr.write(result.error or "supervisor_executor_failed")
            raise SystemExit(1)

        json.dump(
            {
                "summary": result.summary,
                "evidence": result.evidence,
            },
            sys.stdout,
            ensure_ascii=False,
        )
        sys.stdout.flush()
    except SystemExit:
        raise
    except Exception as error:
        sys.stderr.write(f"{type(error).__name__}:{error}")
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
