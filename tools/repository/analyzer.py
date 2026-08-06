from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


class RepositoryAnalyzerError(RuntimeError):
    """Raised when repository analysis cannot complete."""


SUPPORTED_SOURCE_SUFFIXES = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
}


IGNORED_DIRECTORIES = {
    ".git",
    ".next",
    ".turbo",
    ".atlas",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "tmp",
}


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class RepositoryFile:
    path: str
    suffix: str
    size: int

    @property
    def language(self) -> str:
        mapping = {
            ".ts": "typescript",
            ".tsx": "typescript-react",
            ".js": "javascript",
            ".jsx": "javascript-react",
            ".py": "python",
        }

        return mapping.get(
            self.suffix,
            "unknown",
        )


@dataclass(
    slots=True,
    kw_only=True,
)
class RepositoryAnalysis:
    root: str
    files: list[RepositoryFile] = field(
        default_factory=list,
    )

    @property
    def total_files(self) -> int:
        return len(self.files)

    @property
    def total_size(self) -> int:
        return sum(
            item.size
            for item in self.files
        )

    def files_by_language(
        self,
        language: str,
    ) -> list[RepositoryFile]:
        normalized = language.strip().lower()

        return [
            item
            for item in self.files
            if item.language == normalized
        ]

    def find_by_name(
        self,
        name: str,
    ) -> list[RepositoryFile]:
        normalized = name.strip().lower()

        if not normalized:
            return []

        return [
            item
            for item in self.files
            if Path(item.path).name.lower()
            == normalized
        ]

    def search_paths(
        self,
        query: str,
    ) -> list[RepositoryFile]:
        normalized = query.strip().lower()

        if not normalized:
            return []

        return [
            item
            for item in self.files
            if normalized
            in item.path.lower()
        ]

    def to_dict(self) -> dict:
        return {
            "root": self.root,
            "total_files": self.total_files,
            "total_size": self.total_size,
            "files": [
                {
                    "path": item.path,
                    "suffix": item.suffix,
                    "language": item.language,
                    "size": item.size,
                }
                for item in self.files
            ],
        }


class RepositoryAnalyzer:
    """
    Scan an Atlas repository and produce a stable file index.

    v1 intentionally avoids parsing source code. It only builds
    a trusted repository inventory for later symbol indexing.
    """

    def __init__(
        self,
        root: str | Path,
        *,
        ignored_directories: (
            Iterable[str] | None
        ) = None,
    ) -> None:
        self.root = Path(
            root
        ).expanduser().resolve()

        ignored = set(
            ignored_directories
            or IGNORED_DIRECTORIES
        )

        self.ignored_directories = {
            item.strip()
            for item in ignored
            if item.strip()
        }

    def analyze(self) -> RepositoryAnalysis:
        if not self.root.exists():
            raise RepositoryAnalyzerError(
                f"Repository does not exist: "
                f"{self.root}"
            )

        if not self.root.is_dir():
            raise RepositoryAnalyzerError(
                f"Repository root is not a directory: "
                f"{self.root}"
            )

        files: list[RepositoryFile] = []

        for path in self.root.rglob("*"):
            if not path.is_file():
                continue

            if self._is_ignored(path):
                continue

            suffix = path.suffix.lower()

            if suffix not in SUPPORTED_SOURCE_SUFFIXES:
                continue

            relative = path.relative_to(
                self.root
            )

            files.append(
                RepositoryFile(
                    path=relative.as_posix(),
                    suffix=suffix,
                    size=path.stat().st_size,
                )
            )

        files.sort(
            key=lambda item: item.path
        )

        return RepositoryAnalysis(
            root=str(self.root),
            files=files,
        )

    def _is_ignored(
        self,
        path: Path,
    ) -> bool:
        try:
            relative = path.relative_to(
                self.root
            )
        except ValueError:
            return True

        return any(
            part in self.ignored_directories
            for part in relative.parts
        )
