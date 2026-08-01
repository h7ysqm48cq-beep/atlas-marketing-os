from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True, frozen=True)
class ConstructorParameter:
    """
    Represents a TypeScript constructor parameter.

    Example:

        ConstructorParameter(
            name="config",
            parameter_type="ConfigService",
            visibility="private",
            readonly=True,
        )

    Produces a parameter declaration conceptually equivalent to:

        private readonly config: ConfigService
    """

    name: str
    parameter_type: str
    visibility: str = "private"
    readonly: bool = True

    def __post_init__(self) -> None:
        name = self.name.strip()
        parameter_type = self.parameter_type.strip()
        visibility = self.visibility.strip()

        if not name:
            raise ValueError(
                "Constructor parameter name cannot be empty"
            )

        if not parameter_type:
            raise ValueError(
                "Constructor parameter type cannot be empty"
            )

        allowed_visibility = {
            "",
            "public",
            "protected",
            "private",
        }

        if visibility not in allowed_visibility:
            raise ValueError(
                "visibility must be one of: "
                "'', 'public', 'protected', 'private'"
            )

        object.__setattr__(
            self,
            "name",
            name,
        )

        object.__setattr__(
            self,
            "parameter_type",
            parameter_type,
        )

        object.__setattr__(
            self,
            "visibility",
            visibility,
        )

    def declaration(self) -> str:
        """
        Return the TypeScript declaration for this parameter.
        """

        parts: list[str] = []

        if self.visibility:
            parts.append(self.visibility)

        if self.readonly:
            parts.append("readonly")

        parts.append(
            f"{self.name}: {self.parameter_type}"
        )

        return " ".join(parts)


class ConstructorModifier:
    """
    First-generation TypeScript constructor modifier.

    Public API:

        ConstructorModifier.load(path)
        modifier.has_parameter(name, parameter_type)
        modifier.add_parameter(parameter)
        modifier.source()
        modifier.save()

    Patch 008 establishes the stable public API.

    The actual constructor insertion implementation is introduced
    in the next constructor modification patch.
    """

    def __init__(
        self,
        path: Path,
        text: str,
    ) -> None:
        self.path = path
        self._original_text = text
        self._text = text
        self.dirty = False

    @classmethod
    def load(
        cls,
        path: str | Path,
    ) -> "ConstructorModifier":
        """
        Load a TypeScript file from disk.
        """

        file_path = Path(path)

        if not file_path.exists():
            raise FileNotFoundError(
                f"TypeScript file not found: {file_path}"
            )

        if not file_path.is_file():
            raise ValueError(
                f"Expected a file path: {file_path}"
            )

        text = file_path.read_text(
            encoding="utf-8",
        )

        return cls(
            path=file_path,
            text=text,
        )

    def has_parameter(
        self,
        name: str,
        parameter_type: str | None = None,
    ) -> bool:
        """
        Check whether a constructor parameter already exists.

        Patch 008 uses a conservative textual check.

        A later implementation may use AST positions internally
        without changing this method's public API.
        """

        normalized_name = name.strip()

        if not normalized_name:
            raise ValueError(
                "Constructor parameter name cannot be empty"
            )

        if parameter_type is None:
            patterns = (
                f"{normalized_name}:",
                f"{normalized_name} :",
            )

            return any(
                pattern in self._text
                for pattern in patterns
            )

        normalized_type = parameter_type.strip()

        if not normalized_type:
            raise ValueError(
                "Constructor parameter type cannot be empty"
            )

        patterns = (
            f"{normalized_name}: {normalized_type}",
            f"{normalized_name}:{normalized_type}",
            f"{normalized_name} : {normalized_type}",
            f"{normalized_name} :{normalized_type}",
        )

        return any(
            pattern in self._text
            for pattern in patterns
        )

    def add_parameter(
        self,
        parameter: ConstructorParameter,
    ) -> bool:
        """
        Add a parameter to the target TypeScript constructor.

        The stable API is established in Patch 008.

        The actual source transformation is intentionally implemented
        in the next patch after constructor parsing and insertion rules
        are validated.
        """

        if not isinstance(
            parameter,
            ConstructorParameter,
        ):
            raise TypeError(
                "parameter must be a ConstructorParameter"
            )

        if self.has_parameter(
            parameter.name,
            parameter.parameter_type,
        ):
            return False

        raise NotImplementedError(
            "Constructor insertion is not implemented in Patch 008. "
            "Apply the next constructor modification patch."
        )

    def source(self) -> str:
        """
        Return the current in-memory source.
        """

        return self._text

    def original_source(self) -> str:
        """
        Return the source as it was when loaded or last saved.
        """

        return self._original_text

    def has_changes(self) -> bool:
        """
        Return True when the in-memory source has changed.
        """

        return self._text != self._original_text

    def reset(self) -> None:
        """
        Discard unsaved in-memory changes.
        """

        self._text = self._original_text
        self.dirty = False

    def save(self) -> bool:
        """
        Save the modified source to disk.

        Returns:
            True when the file was written.
            False when there were no changes.
        """

        if not self.has_changes():
            self.dirty = False
            return False

        self.path.write_text(
            self._text,
            encoding="utf-8",
        )

        self._original_text = self._text
        self.dirty = False

        return True
