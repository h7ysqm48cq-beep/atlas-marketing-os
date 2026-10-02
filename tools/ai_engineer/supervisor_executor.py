from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import json
import re
import subprocess
import sys
from typing import Any, Mapping

if __package__:
    from .crud import CRUDGenerationError, CRUDGenerator
    from .engine import build_default_ai_engineer
    from .natural_language import build_natural_language_engineer
    from .request import AIEngineerMode, AIEngineerOperation
    from tools.runtime import build_default_runtime
    from tools.runtime.executors import WorkspaceEditExecutor
    from tools.ir.action import (
        WorkspaceEdit,
        WorkspaceFileEdit,
        WorkspaceTextEdit,
    )
    from tools.ir.plan import ExecutionPlan
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tools.ai_engineer.crud import CRUDGenerationError, CRUDGenerator
    from tools.ai_engineer.engine import build_default_ai_engineer
    from tools.ai_engineer.natural_language import build_natural_language_engineer
    from tools.ai_engineer.request import AIEngineerMode, AIEngineerOperation
    from tools.runtime import build_default_runtime
    from tools.runtime.executors import WorkspaceEditExecutor
    from tools.ir.action import (
        WorkspaceEdit,
        WorkspaceFileEdit,
        WorkspaceTextEdit,
    )
    from tools.ir.plan import ExecutionPlan


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


EXACT_WORKSPACE_EDIT_PREFIX = "EXACT_WORKSPACE_EDIT "


class SupervisorAssignmentExecutor:
    def __init__(
        self,
        *,
        project_root: str | Path,
        engineer: Any | None = None,
    ) -> None:
        self.project_root = Path(project_root).expanduser().resolve()
        if engineer is not None:
            self.engineer = engineer
        else:
            default_engineer = build_natural_language_engineer()
            default_engineer.engineer = build_default_ai_engineer(
                runtime=build_default_runtime(
                    project_root=self.project_root,
                    show_preview=True,
                )
            )
            self.engineer = default_engineer

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
        if assignment.get("verificationMode") == "IMPLEMENTATION_RESULT":
            return self._verify_implementation_result(assignment)
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

        if objective.startswith(
            EXACT_WORKSPACE_EDIT_PREFIX
        ):
            return self._execute_exact_workspace_edit(
                assignment,
                objective,
                allowed,
                allow_apply=allow_apply,
            )

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

        if isinstance(target_file, str):
            planned_paths = [
                _normalize_relative_path(target_file)
            ]
        elif request.operation == AIEngineerOperation.CREATE_CRUD:
            resource_name = request.arguments.get("resource_name")
            if not isinstance(resource_name, str):
                return self._failure(
                    "supervisor_operation_not_supported",
                    planning={
                        "requiresReview": True,
                        "operation": operation,
                    },
                )
            try:
                crud_plan = CRUDGenerator(
                    self.project_root
                ).plan(resource_name)
                planned_paths = [
                    _normalize_relative_path(
                        item.path
                    )
                    for item in crud_plan.files
                ]
            except CRUDGenerationError:
                return self._failure(
                    "supervisor_operation_not_supported",
                    planning={
                        "requiresReview": True,
                        "operation": operation,
                    },
                )
        else:
            return self._failure(
                "supervisor_operation_not_supported",
                planning={
                    "requiresReview": True,
                    "operation": operation,
                },
            )
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
            detail = self._apply_failure_detail(applied)
            error = "supervisor_apply_failed"
            if detail:
                error = f"{error}:{detail}"
            return self._failure(error, planning=planning)

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

    def _execute_exact_workspace_edit(
        self,
        assignment: Mapping[str, Any],
        objective: str,
        allowed: set[str],
        *,
        allow_apply: bool,
    ) -> SupervisorExecutorResult:
        planning = {
            "requiresReview": False,
            "operation": "exact_workspace_edit",
            "plannedPaths": sorted(allowed),
        }

        if self._operation_forbidden(
            "edit_assigned_files",
            assignment,
        ):
            return self._failure(
                "supervisor_forbidden_action",
                planning=planning,
            )

        if not allow_apply:
            return self._failure(
                "supervisor_apply_not_authorized",
                planning=planning,
            )

        raw = objective[
            len(EXACT_WORKSPACE_EDIT_PREFIX):
        ].strip()

        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            return self._failure(
                "supervisor_workspace_edit_payload_invalid",
                planning=planning,
            )

        if (
            not isinstance(payload, dict)
            or set(payload) != {"version", "files"}
            or payload.get("version") != 1
            or not isinstance(payload.get("files"), list)
            or not payload["files"]
        ):
            return self._failure(
                "supervisor_workspace_edit_payload_invalid",
                planning=planning,
            )

        file_edits: list[WorkspaceFileEdit] = []
        payload_paths: set[str] = set()

        for file_item in payload["files"]:
            if (
                not isinstance(file_item, dict)
                or set(file_item)
                != {"file_path", "replacements"}
            ):
                return self._failure(
                    "supervisor_workspace_edit_payload_invalid",
                    planning=planning,
                )

            raw_path = file_item.get("file_path")

            if not isinstance(raw_path, str):
                return self._failure(
                    "supervisor_workspace_edit_payload_invalid",
                    planning=planning,
                )

            try:
                relative = _normalize_relative_path(
                    raw_path
                )
            except ValueError:
                return self._failure(
                    "supervisor_workspace_edit_payload_invalid",
                    planning=planning,
                )

            if relative not in allowed:
                return self._failure(
                    "supervisor_scope_violation",
                    planning=planning,
                )

            if relative in payload_paths:
                return self._failure(
                    "supervisor_workspace_edit_duplicate_path",
                    planning=planning,
                )

            payload_paths.add(relative)

            suffix = PurePosixPath(
                relative
            ).suffix.lower()

            if suffix not in {
                ".ts",
                ".tsx",
                ".yml",
                ".yaml",
                ".mjs",
                ".cjs",
            }:
                return self._failure(
                    "supervisor_workspace_edit_failed:"
                    "WorkspaceEdit target suffix is not "
                    f"allowed: {relative}",
                    planning=planning,
                )

            replacements = file_item.get(
                "replacements"
            )

            if (
                not isinstance(replacements, list)
                or not replacements
            ):
                return self._failure(
                    "supervisor_workspace_edit_payload_invalid",
                    planning=planning,
                )

            target = self.project_root / relative

            try:
                original = target.read_text(
                    encoding="utf-8"
                )
            except (OSError, UnicodeError):
                return self._failure(
                    "supervisor_workspace_edit_target_invalid",
                    planning=planning,
                )

            edits: list[WorkspaceTextEdit] = []

            for replacement in replacements:
                if (
                    not isinstance(replacement, dict)
                    or set(replacement)
                    != {"old", "new"}
                ):
                    return self._failure(
                        "supervisor_workspace_edit_payload_invalid",
                        planning=planning,
                    )

                old_text = replacement.get("old")
                new_text = replacement.get("new")

                if (
                    not isinstance(old_text, str)
                    or not old_text
                    or not isinstance(new_text, str)
                    or old_text == new_text
                ):
                    return self._failure(
                        "supervisor_workspace_edit_payload_invalid",
                        planning=planning,
                    )

                if original.count(old_text) != 1:
                    return self._failure(
                        "supervisor_workspace_edit_exact_match_invalid",
                        planning=planning,
                    )

                start = original.index(old_text)

                edits.append(
                    WorkspaceTextEdit(
                        start=start,
                        end=start + len(old_text),
                        text=new_text,
                    )
                )

            file_edits.append(
                WorkspaceFileEdit(
                    file_path=relative,
                    edits=tuple(edits),
                )
            )

        if payload_paths != allowed:
            return self._failure(
                "supervisor_scope_violation",
                planning=planning,
            )

        if self._git_changed_files():
            return self._failure(
                "supervisor_workspace_not_clean",
                planning=planning,
            )

        includes_node_scripts = any(
            PurePosixPath(
                file_edit.file_path
            ).suffix.lower() in {".mjs", ".cjs"}
            for file_edit in file_edits
        )

        action = WorkspaceEdit(
            files=tuple(file_edits),
            allowed_suffixes=(
                ".ts",
                ".tsx",
                ".yml",
                ".yaml",
            )
            + ((".mjs", ".cjs") if includes_node_scripts else ()),
        )

        if includes_node_scripts:
            try:
                WorkspaceEditExecutor(
                    project_root=self.project_root,
                    dry_run=False,
                    show_preview=True,
                ).execute(action)
            except Exception as error:
                changed = self._git_changed_files()

                if changed:
                    self._restore_clean_workspace(
                        changed
                    )

                normalized = re.sub(
                    r"\s+",
                    " ",
                    str(error).strip(),
                )[:500]

                return self._failure(
                    "supervisor_workspace_edit_failed:"
                    + normalized,
                    planning=planning,
                )
        else:
            plan = ExecutionPlan(
                title="Supervisor exact workspace edit",
                target_project=str(self.project_root),
                actions=[action],
                metadata={
                    "operation": "exact_workspace_edit",
                },
            )

            runtime = build_default_runtime(
                project_root=self.project_root,
                show_preview=True,
            )

            result = runtime.run(
                plan,
                dry_run=False,
                rollback_on_failure=True,
            )

            if not result.success:
                changed = self._git_changed_files()

                if changed:
                    self._restore_clean_workspace(
                        changed
                    )

                detail = (
                    result.errors[0]
                    if result.errors
                    else "unknown"
                )

                normalized = re.sub(
                    r"\s+",
                    " ",
                    str(detail).strip(),
                )[:500]

                return self._failure(
                    "supervisor_workspace_edit_failed:"
                    + normalized,
                    planning=planning,
                )

        changed = self._git_changed_files()

        if set(changed) != allowed:
            if changed:
                self._restore_clean_workspace(
                    changed
                )

            return self._failure(
                "supervisor_workspace_edit_changed_paths_mismatch",
                planning=planning,
            )

        evidence = self._evidence(changed)
        evidence["rootCause"] = (
            "exact_bounded_workspace_edit"
        )

        return SupervisorExecutorResult(
            success=True,
            summary=(
                "Applied exact WorkspaceEdit "
                "within Supervisor scope."
            ),
            evidence=evidence,
            planning=planning,
        )

    def _verify_implementation_result(
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
            return self._failure("implementation_result_identity_invalid")
        try:
            self._assert_safe_allowed_targets(self._allowed_paths(assignment))
            head = subprocess.run(
                ["git", "rev-parse", "--verify", "HEAD"],
                cwd=self.project_root, text=True, capture_output=True, check=True,
            ).stdout.strip().lower()
            changed = self._git_changed_files()
        except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
            return self._failure(
                f"implementation_result_git_verification_failed:{error}"
            )
        if head != sha or changed:
            return self._failure("implementation_result_head_or_workspace_mismatch")
        return SupervisorExecutorResult(
            success=True,
            summary="Verified clean zero-diff implementation result at exact production SHA.",
            evidence={
                "rootCause": "zero_diff_implementation_requires_independent_source_verification",
                "changedFiles": [],
                "tests": ["git_head_exact", "git_worktree_clean"],
                "build": "NOT_RUN",
                "regression": [],
                "deploymentState": "NOT_DEPLOYED",
                "gitState": "CLEAN",
                "remainingRisk": ["implementation_tests_are_preserved_on_task_evidence"],
            },
        )

    def _verify_runtime_refresh(
        self, assignment: Mapping[str, Any]
    ) -> SupervisorExecutorResult:
        sha = assignment.get("candidateHeadSha")
        objective = assignment.get("objective")
        if (
            assignment.get("executionPurpose") != "INDEPENDENT_VERIFICATION"
            or not isinstance(sha, str)
            or len(sha) != 40
            or any(c not in "0123456789abcdef" for c in sha)
            or sha != assignment.get("candidateBaseSha")
            or sha != assignment.get("productionBaselineSha")
        ):
            return self._failure("runtime_refresh_identity_invalid")
        if not isinstance(objective, str):
            return self._failure("runtime_refresh_service_invalid")
        lowered_objective = objective.lower()
        if re.search(r"zero-git-diff.*api.*runtime refresh", lowered_objective):
            service = "api"
        else:
            match = re.search(
                r"zero-git-diff.*(engineering-runner|engineering-verifier|browser-worker|web|production-deploy-executor).*"
                r"production qualification",
                lowered_objective,
            )
            if not match:
                return self._failure("runtime_refresh_service_invalid")
            service = match.group(1)
        # The runtime refresh has zero changedPaths, but the Supervisor
        # requires nonempty allowedPaths for Task ownership and carries them
        # unchanged in the Runner assignment. Validate that scope without
        # treating it as Git changes or permitting workspace drift.
        try:
            self._assert_safe_allowed_targets(self._allowed_paths(assignment))
            head = subprocess.run(
                ["git", "rev-parse", "--verify", "HEAD"],
                cwd=self.project_root, text=True, capture_output=True, check=True,
            ).stdout.strip().lower()
            changed = self._git_changed_files()
        except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
            return self._failure(f"runtime_refresh_git_verification_failed:{error}")
        if head != sha or changed:
            return self._failure("runtime_refresh_head_or_workspace_mismatch")
        summary = (
            "Verified clean same-SHA API runtime refresh workspace."
            if service == "api"
            else f"Verified clean same-SHA {service} production qualification workspace."
        )
        remaining_risk = (
            ["api_build_not_run"]
            if service == "api"
            else ["service_deployment_not_authorized"]
        )
        return SupervisorExecutorResult(
            success=True,
            summary=summary,
            evidence={
                "rootCause": "runtime_refresh_requires_no_git_change",
                "changedFiles": [],
                "tests": [
                    "git_head_exact",
                    "git_worktree_clean",
                    "qualification_service_" + service.replace("-", "_"),
                ],
                "build": "NOT_RUN",
                "regression": [],
                "deploymentState": "NOT_DEPLOYED",
                "gitState": "CLEAN",
                "remainingRisk": remaining_risk,
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
        ):
            return self._failure("existing_candidate_identity_invalid")

        try:
            allowed = self._allowed_paths(assignment)
            self._assert_safe_allowed_targets(allowed)
            if self._git_changed_files():
                return self._failure("existing_candidate_workspace_dirty")

            resolved: dict[str, str] = {}
            for label, sha in (("base", base), ("head", head), ("baseline", baseline)):
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
            subprocess.run(
                ["git", "merge-base", "--is-ancestor", base.lower(), baseline.lower()],
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

            production_raw = subprocess.run(
                [
                    "git", "diff", "--no-renames", "--no-ext-diff",
                    "--no-textconv", "--name-only", "-z",
                    base.lower(), baseline.lower(),
                ],
                cwd=self.project_root, text=True, capture_output=True, check=True,
            ).stdout
            production_changed = {
                _normalize_relative_path(path)
                for path in production_raw.split("\0")
                if path
            }
            if production_changed.intersection(changed):
                return self._failure("existing_candidate_production_scope_overlap")

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
                    "production_baseline_verified",
                    "production_scope_no_overlap",
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
    def _apply_failure_detail(applied: Any) -> str | None:
        try:
            errors = applied.engineer_result.planner_result.runtime_result.errors
        except AttributeError:
            return None
        if not isinstance(errors, list):
            return None
        for value in errors:
            if isinstance(value, str) and value.strip():
                normalized = re.sub(r"\s+", " ", value.strip())
                return normalized[:500]
        return None

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
