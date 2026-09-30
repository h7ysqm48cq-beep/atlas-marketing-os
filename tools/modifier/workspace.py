from pathlib import Path

from .typescript import TypeScriptFile


class Workspace:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()

    def resolve(self, path: str | Path) -> Path:
        resolved = (self.root / path).resolve()

        try:
            resolved.relative_to(self.root)
        except ValueError as error:
            raise ValueError(
                f"Path escapes workspace root: {path}"
            ) from error

        return resolved

    def typescript(self, path: str | Path) -> TypeScriptFile:
        return TypeScriptFile.load(self.resolve(path))
