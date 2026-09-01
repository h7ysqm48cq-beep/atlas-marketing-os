from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from tools.repository import (
    AtlasProject,
    default_repository_cache,
)

from .intent import (
    EngineeringIntent,
    IntentType,
)


class EngineeringReasonerError(RuntimeError):
    """Raised when repository reasoning cannot complete."""


class EngineeringRisk(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class RelatedFileRole(str, Enum):
    PRIMARY = "primary"
    STYLE = "style"
    PAGE = "page"
    LAYOUT = "layout"
    DEPENDENCY = "dependency"
    SHARED = "shared"
    TEST = "test"
    UNKNOWN = "unknown"


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class RelatedFile:
    file_path: str
    role: RelatedFileRole
    score: int
    reasons: tuple[str, ...] = ()
    symbols: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_path": self.file_path,
            "role": self.role.value,
            "score": self.score,
            "reasons": list(self.reasons),
            "symbols": list(self.symbols),
        }


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class EngineeringImpact:
    affected_files: int
    component_files: int
    style_files: int
    page_files: int
    shared_files: int
    affected_symbols: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "affected_files": self.affected_files,
            "component_files": self.component_files,
            "style_files": self.style_files,
            "page_files": self.page_files,
            "shared_files": self.shared_files,
            "affected_symbols": list(
                self.affected_symbols
            ),
        }


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class EngineeringPlan:
    title: str
    summary: str
    intent: EngineeringIntent
    related_files: tuple[RelatedFile, ...]
    impact: EngineeringImpact
    risk: EngineeringRisk
    confidence: float
    recommended_actions: tuple[str, ...]
    requires_approval: bool = True
    warnings: tuple[str, ...] = ()

    @property
    def executable(self) -> bool:
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "summary": self.summary,
            "intent": self.intent.to_dict(),
            "related_files": [
                item.to_dict()
                for item in self.related_files
            ],
            "impact": self.impact.to_dict(),
            "risk": self.risk.value,
            "confidence": self.confidence,
            "recommended_actions": list(
                self.recommended_actions
            ),
            "requires_approval": (
                self.requires_approval
            ),
            "warnings": list(self.warnings),
            "executable": self.executable,
        }


@dataclass(slots=True)
class _FileCandidate:
    file_path: str
    score: int = 0
    reasons: list[str] = field(
        default_factory=list
    )

    def add(
        self,
        score: int,
        reason: str,
    ) -> None:
        self.score += score

        if reason not in self.reasons:
            self.reasons.append(reason)


class RepositoryReasoner:
    """
    Produce a conservative engineering impact plan.

    v1 supports UI redesign and investigation intents.
    It never writes files or creates Runtime actions.
    """

    _style_suffixes = (
        ".css",
        ".scss",
        ".sass",
        ".less",
    )

    _source_suffixes = (
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
    )

    _shared_names = {
        "layout",
        "sidebar",
        "header",
        "theme",
        "globals",
        "preferences",
        "tokens",
        "provider",
    }

    _generic_words = {
        "the",
        "and",
        "or",
        "with",
        "from",
        "for",
        "using",
        "this",
        "that",
        "please",
        "help",
        "make",
        "change",
        "redesign",
        "design",
        "improve",
        "update",
        "fix",
        "page",
        "screen",
        "component",
        "interface",
        "ui",
        "帮我",
        "重新",
        "设计",
        "优化",
        "修改",
        "改成",
        "页面",
        "界面",
        "手机版",
        "一点",
    }

    def reason(
        self,
        intent: EngineeringIntent,
        *,
        target_project: str = ".",
        max_files: int = 24,
    ) -> EngineeringPlan:
        if not isinstance(
            intent,
            EngineeringIntent,
        ):
            raise TypeError(
                "intent must be an EngineeringIntent"
            )

        if (
            not isinstance(max_files, int)
            or max_files < 1
        ):
            raise ValueError(
                "max_files must be a positive integer"
            )

        root = Path(
            target_project
        ).expanduser().resolve()

        if not root.exists():
            raise EngineeringReasonerError(
                f"Repository does not exist: {root}"
            )

        project = default_repository_cache.get(
            root
        )

        terms = self._search_terms(intent)

        candidates = self._collect_candidates(
            project,
            terms,
        )

        related = self._build_related_files(
            project,
            candidates,
            max_files=max_files,
        )

        impact = self._build_impact(
            related
        )

        risk = self._estimate_risk(
            intent,
            related,
            impact,
        )

        confidence = self._estimate_confidence(
            intent,
            related,
        )

        warnings = self._warnings(
            intent,
            related,
        )

        return EngineeringPlan(
            title=self._title(intent),
            summary=self._summary(
                intent,
                related,
                risk,
            ),
            intent=intent,
            related_files=related,
            impact=impact,
            risk=risk,
            confidence=confidence,
            recommended_actions=(
                self._recommended_actions(
                    intent,
                    related,
                )
            ),
            requires_approval=True,
            warnings=warnings,
        )

    def _collect_candidates(
        self,
        project: AtlasProject,
        terms: tuple[str, ...],
    ) -> dict[str, _FileCandidate]:
        candidates: dict[
            str,
            _FileCandidate,
        ] = {}

        all_paths = {
            item.path
            for item in project.analysis.files
        }

        for path in project.root.rglob("*"):
            if (
                path.is_file()
                and path.suffix.lower()
                in self._style_suffixes
                and not self._ignored(path)
            ):
                all_paths.add(
                    path.relative_to(
                        project.root
                    ).as_posix()
                )

        for file_path in sorted(all_paths):
            lowered = file_path.lower()
            name = Path(file_path).stem.lower()

            candidate = _FileCandidate(
                file_path=file_path
            )

            for term in terms:
                normalized = term.lower()

                if name == normalized:
                    candidate.add(
                        100,
                        f"filename matches {term}",
                    )
                elif normalized in name:
                    candidate.add(
                        65,
                        f"filename contains {term}",
                    )
                elif normalized in lowered:
                    candidate.add(
                        35,
                        f"path contains {term}",
                    )

            if candidate.score > 0:
                candidates[file_path] = candidate

        primary_paths = {
            path
            for path, candidate
            in candidates.items()
            if candidate.score >= 60
        }

        for primary_path in tuple(
            primary_paths
        ):
            primary = Path(primary_path)
            stem = primary.stem.replace(
                ".module",
                "",
            )

            for file_path in sorted(all_paths):
                path = Path(file_path)

                if file_path == primary_path:
                    continue

                related_by_stem = (
                    path.stem.replace(
                        ".module",
                        "",
                    ).lower()
                    == stem.lower()
                )

                same_directory = (
                    path.parent
                    == primary.parent
                )

                if related_by_stem:
                    item = candidates.setdefault(
                        file_path,
                        _FileCandidate(
                            file_path=file_path
                        ),
                    )
                    item.add(
                        55,
                        f"paired with {primary_path}",
                    )

                elif (
                    same_directory
                    and path.suffix.lower()
                    in self._style_suffixes
                ):
                    item = candidates.setdefault(
                        file_path,
                        _FileCandidate(
                            file_path=file_path
                        ),
                    )
                    item.add(
                        20,
                        f"style file near {primary_path}",
                    )

        self._add_shared_ui_files(
            all_paths,
            candidates,
        )

        self._add_dependency_files(
            project,
            primary_paths,
            candidates,
        )

        return candidates

    def _add_shared_ui_files(
        self,
        all_paths: set[str],
        candidates: dict[
            str,
            _FileCandidate,
        ],
    ) -> None:
        if not candidates:
            return

        has_web_ui = any(
            path.startswith(
                "apps/web/"
            )
            for path in candidates
        )

        if not has_web_ui:
            return

        for file_path in all_paths:
            path = Path(file_path)
            lowered_stem = (
                path.stem
                .replace(".module", "")
                .lower()
            )

            is_shared_name = any(
                shared_name == lowered_stem
                or shared_name in lowered_stem
                for shared_name
                in self._shared_names
            )

            if not is_shared_name:
                continue

            item = candidates.setdefault(
                file_path,
                _FileCandidate(
                    file_path=file_path
                ),
            )
            item.add(
                10,
                "shared UI infrastructure",
            )

    @staticmethod
    def _add_dependency_files(
        project: AtlasProject,
        primary_paths: set[str],
        candidates: dict[
            str,
            _FileCandidate,
        ],
    ) -> None:
        primary_symbols: set[str] = set()

        for file_path in primary_paths:
            for symbol in (
                project.symbols_in_file(
                    file_path
                )
            ):
                primary_symbols.add(
                    symbol.name
                )

        for symbol in primary_symbols:
            for edge in (
                project.dependencies
                .find_symbol_consumers(
                    symbol
                )
            ):
                item = candidates.setdefault(
                    edge.source_file,
                    _FileCandidate(
                        file_path=edge.source_file
                    ),
                )
                item.add(
                    25,
                    f"depends on {symbol}",
                )

    def _build_related_files(
        self,
        project: AtlasProject,
        candidates: dict[
            str,
            _FileCandidate,
        ],
        *,
        max_files: int,
    ) -> tuple[RelatedFile, ...]:
        ordered = sorted(
            candidates.values(),
            key=lambda item: (
                -item.score,
                item.file_path,
            ),
        )[:max_files]

        result: list[RelatedFile] = []

        for item in ordered:
            symbols = tuple(
                symbol.name
                for symbol
                in project.symbols_in_file(
                    item.file_path
                )
            )

            result.append(
                RelatedFile(
                    file_path=item.file_path,
                    role=self._file_role(
                        item.file_path,
                        item.score,
                    ),
                    score=item.score,
                    reasons=tuple(
                        item.reasons
                    ),
                    symbols=symbols,
                )
            )

        return tuple(result)

    @classmethod
    def _file_role(
        cls,
        file_path: str,
        score: int,
    ) -> RelatedFileRole:
        path = Path(file_path)
        lowered = file_path.lower()
        stem = path.stem.lower()

        if path.suffix.lower() in (
            cls._style_suffixes
        ):
            return RelatedFileRole.STYLE

        if (
            "/app/" in lowered
            and path.name.startswith(
                "page."
            )
        ):
            return RelatedFileRole.PAGE

        if (
            "layout" in stem
            or "sidebar" in stem
            or "header" in stem
            or "theme" in stem
            or "preferences" in lowered
        ):
            return RelatedFileRole.LAYOUT

        if (
            ".test." in lowered
            or ".spec." in lowered
            or "/tests/" in lowered
        ):
            return RelatedFileRole.TEST

        if score >= 60:
            return RelatedFileRole.PRIMARY

        if score <= 15:
            return RelatedFileRole.SHARED

        return RelatedFileRole.DEPENDENCY

    @staticmethod
    def _build_impact(
        related: tuple[
            RelatedFile,
            ...,
        ],
    ) -> EngineeringImpact:
        symbols = sorted({
            symbol
            for item in related
            for symbol in item.symbols
        })

        return EngineeringImpact(
            affected_files=len(related),
            component_files=sum(
                Path(item.file_path).suffix
                in {".tsx", ".jsx"}
                for item in related
            ),
            style_files=sum(
                item.role
                == RelatedFileRole.STYLE
                for item in related
            ),
            page_files=sum(
                item.role
                == RelatedFileRole.PAGE
                for item in related
            ),
            shared_files=sum(
                item.role in {
                    RelatedFileRole.SHARED,
                    RelatedFileRole.LAYOUT,
                }
                for item in related
            ),
            affected_symbols=tuple(symbols),
        )

    @staticmethod
    def _estimate_risk(
        intent: EngineeringIntent,
        related: tuple[
            RelatedFile,
            ...,
        ],
        impact: EngineeringImpact,
    ) -> EngineeringRisk:
        if not related:
            return EngineeringRisk.HIGH

        if (
            intent.intent_type
            == IntentType.INVESTIGATE_AND_FIX
        ):
            return EngineeringRisk.HIGH

        if (
            impact.affected_files >= 15
            or impact.shared_files >= 5
        ):
            return EngineeringRisk.HIGH

        if (
            impact.affected_files >= 7
            or impact.shared_files >= 2
        ):
            return EngineeringRisk.MEDIUM

        return EngineeringRisk.LOW

    @staticmethod
    def _estimate_confidence(
        intent: EngineeringIntent,
        related: tuple[
            RelatedFile,
            ...,
        ],
    ) -> float:
        if not related:
            return 0.2

        top_score = related[0].score

        evidence_score = min(
            0.35,
            len(related) * 0.025,
        )

        name_score = min(
            0.35,
            top_score / 300,
        )

        confidence = (
            intent.confidence * 0.3
            + evidence_score
            + name_score
        )

        return round(
            min(confidence, 0.98),
            3,
        )

    @staticmethod
    def _recommended_actions(
        intent: EngineeringIntent,
        related: tuple[
            RelatedFile,
            ...,
        ],
    ) -> tuple[str, ...]:
        if intent.intent_type == (
            IntentType.REDESIGN_UI
        ):
            actions = [
                "Review the primary component structure.",
                "Inspect paired CSS modules and global design tokens.",
                "Prepare desktop and mobile layout changes.",
                "Generate a preview before applying code changes.",
                "Run the web build and responsive UI tests.",
            ]

            if any(
                item.role
                == RelatedFileRole.LAYOUT
                for item in related
            ):
                actions.insert(
                    3,
                    "Limit shared layout changes to avoid unintended page regressions.",
                )

            return tuple(actions)

        return (
            "Review the highest-ranked related files.",
            "Confirm the root cause before modifying code.",
            "Prepare a preview and impact diff.",
            "Run focused tests followed by the full regression suite.",
        )

    @staticmethod
    def _warnings(
        intent: EngineeringIntent,
        related: tuple[
            RelatedFile,
            ...,
        ],
    ) -> tuple[str, ...]:
        warnings: list[str] = []

        if not related:
            warnings.append(
                "No strongly related repository files were found."
            )

        if intent.target is None:
            warnings.append(
                "The request does not identify a precise target."
            )

        if len(related) >= 20:
            warnings.append(
                "The analysis reached the related-file limit."
            )

        return tuple(warnings)

    @classmethod
    def _search_terms(
        cls,
        intent: EngineeringIntent,
    ) -> tuple[str, ...]:
        values: list[str] = []

        if intent.target:
            values.extend(
                cls._split_terms(
                    intent.target
                )
            )

        values.extend(
            cls._split_terms(
                intent.raw_text
            )
        )

        unique: list[str] = []

        for value in values:
            normalized = value.strip()

            if (
                len(normalized) < 3
                or normalized.lower()
                in cls._generic_words
            ):
                continue

            if normalized.lower() not in {
                item.lower()
                for item in unique
            }:
                unique.append(normalized)

        return tuple(unique[:12])

    @staticmethod
    def _split_terms(
        text: str,
    ) -> list[str]:
        expanded = re.sub(
            r"([a-z0-9])([A-Z])",
            r"\1 \2",
            text,
        )

        return re.findall(
            r"[A-Za-z][A-Za-z0-9_-]*"
            r"|[\u4e00-\u9fff]{2,}",
            expanded,
        )

    @staticmethod
    def _title(
        intent: EngineeringIntent,
    ) -> str:
        target = (
            intent.target
            or "Repository change"
        )

        if intent.intent_type == (
            IntentType.REDESIGN_UI
        ):
            return f"UI redesign plan: {target}"

        if intent.intent_type == (
            IntentType.INVESTIGATE_AND_FIX
        ):
            return (
                f"Investigation plan: {target}"
            )

        return f"Engineering plan: {target}"

    @staticmethod
    def _summary(
        intent: EngineeringIntent,
        related: tuple[
            RelatedFile,
            ...,
        ],
        risk: EngineeringRisk,
    ) -> str:
        target = (
            intent.target
            or "the requested area"
        )

        return (
            f"Repository analysis found "
            f"{len(related)} potentially related "
            f"files for {target}. "
            f"Estimated engineering risk is "
            f"{risk.value}. No files were modified."
        )

    @staticmethod
    def _ignored(
        path: Path,
    ) -> bool:
        ignored = {
            ".git",
            ".next",
            ".turbo",
            ".atlas",
            ".atlas-backups",
            "node_modules",
            "dist",
            "build",
            "coverage",
            "__pycache__",
        }

        hidden_backup = re.compile(
            r"^\..+-backup-\d{8}(?:-\d{6})?$"
        )

        return any(
            part in ignored
            or hidden_backup.fullmatch(part)
            for part in path.parts
        )
