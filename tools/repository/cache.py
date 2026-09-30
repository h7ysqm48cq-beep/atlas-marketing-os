from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import monotonic

from .project import AtlasProject


class RepositoryCacheError(RuntimeError):
    """Raised when repository cache operations fail."""


@dataclass(
    slots=True,
)
class RepositoryCacheEntry:
    project: AtlasProject
    created_at: float
    fingerprint: tuple[
        tuple[str, int, int],
        ...,
    ]

    def expired(
        self,
        *,
        ttl_seconds: float,
    ) -> bool:
        return (
            monotonic() - self.created_at
            > ttl_seconds
        )


class RepositoryCache:
    """
    In-memory AtlasProject cache.

    Cache invalidation uses:
    - TTL
    - source file path
    - file size
    - modified time
    """

    def __init__(
        self,
        *,
        ttl_seconds: float = 30.0,
    ) -> None:
        if ttl_seconds < 0:
            raise ValueError(
                "ttl_seconds cannot be negative"
            )

        self.ttl_seconds = ttl_seconds

        self._entries: dict[
            Path,
            RepositoryCacheEntry,
        ] = {}

    def get(
        self,
        root: str | Path,
    ) -> AtlasProject:
        resolved = Path(
            root
        ).expanduser().resolve()

        fingerprint = self._fingerprint(
            resolved
        )

        entry = self._entries.get(
            resolved
        )

        if (
            entry is not None
            and not entry.expired(
                ttl_seconds=self.ttl_seconds
            )
            and entry.fingerprint
            == fingerprint
        ):
            return entry.project

        project = AtlasProject.load(
            resolved
        )

        self._entries[resolved] = (
            RepositoryCacheEntry(
                project=project,
                created_at=monotonic(),
                fingerprint=fingerprint,
            )
        )

        return project

    def invalidate(
        self,
        root: str | Path,
    ) -> bool:
        resolved = Path(
            root
        ).expanduser().resolve()

        return (
            self._entries.pop(
                resolved,
                None,
            )
            is not None
        )

    def clear(self) -> None:
        self._entries.clear()

    def contains(
        self,
        root: str | Path,
    ) -> bool:
        resolved = Path(
            root
        ).expanduser().resolve()

        return resolved in self._entries

    @property
    def size(self) -> int:
        return len(self._entries)

    @staticmethod
    def _fingerprint(
        root: Path,
    ) -> tuple[
        tuple[str, int, int],
        ...,
    ]:
        if not root.exists():
            raise RepositoryCacheError(
                f"Repository does not exist: "
                f"{root}"
            )

        if not root.is_dir():
            raise RepositoryCacheError(
                f"Repository root is not "
                f"a directory: {root}"
            )

        ignored = {
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

        supported = {
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".py",
        }

        entries: list[
            tuple[str, int, int]
        ] = []

        for path in root.rglob("*"):
            if not path.is_file():
                continue

            relative = path.relative_to(
                root
            )

            if any(
                part in ignored
                for part in relative.parts
            ):
                continue

            if (
                path.suffix.lower()
                not in supported
            ):
                continue

            stat = path.stat()

            entries.append(
                (
                    relative.as_posix(),
                    stat.st_size,
                    stat.st_mtime_ns,
                )
            )

        entries.sort()

        return tuple(entries)


default_repository_cache = (
    RepositoryCache()
)
