from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable


class ConstructorParameterError(ValueError):
    """Base validation error for ConstructorParameter."""


class InvalidParameterName(ConstructorParameterError):
    """Raised when a parameter name is not a valid identifier."""


class InvalidParameterType(ConstructorParameterError):
    """Raised when a parameter type is empty or invalid."""


class InvalidParameterVisibility(ConstructorParameterError):
    """Raised when visibility is not supported."""


class InvalidParameterConfiguration(ConstructorParameterError):
    """Raised when parameter options conflict."""


_IDENTIFIER_PATTERN = re.compile(
    r"^[A-Za-z_$][A-Za-z0-9_$]*$"
)

_ALLOWED_VISIBILITIES = {
    "public",
    "protected",
    "private",
}


def _validate_non_empty_string(
    value: str,
    field_name: str,
) -> str:
    if not isinstance(value, str):
        raise TypeError(
            f"{field_name} must be a string"
        )

    normalized = value.strip()

    if not normalized:
        raise ConstructorParameterError(
            f"{field_name} cannot be empty"
        )

    return normalized


def _normalize_decorators(
    decorators: Iterable[str],
) -> tuple[str, ...]:
    if isinstance(decorators, str):
        raise TypeError(
            "decorators must be an iterable of strings, "
            "not a single string"
        )

    normalized: list[str] = []

    for decorator in decorators:
        value = _validate_non_empty_string(
            decorator,
            "decorator",
        )

        if not value.startswith("@"):
            value = f"@{value}"

        normalized.append(value)

    return tuple(normalized)


@dataclass(frozen=True, slots=True)
class ConstructorParameter:
    """
    Language-neutral representation of a constructor parameter.

    The TypeScript-specific output is produced by
    render_typescript_constructor_parameter().
    """

    name: str
    type: str

    visibility: str | None = "private"
    readonly: bool = True
    optional: bool = False
    default: str | None = None

    decorators: tuple[str, ...] = field(
        default_factory=tuple
    )

    def __post_init__(self) -> None:
        name = _validate_non_empty_string(
            self.name,
            "name",
        )

        parameter_type = _validate_non_empty_string(
            self.type,
            "type",
        )

        if not _IDENTIFIER_PATTERN.fullmatch(name):
            raise InvalidParameterName(
                f"Invalid constructor parameter name: "
                f"{name!r}"
            )

        visibility = self.visibility

        if visibility is not None:
            visibility = _validate_non_empty_string(
                visibility,
                "visibility",
            ).lower()

            if visibility not in _ALLOWED_VISIBILITIES:
                allowed = ", ".join(
                    sorted(_ALLOWED_VISIBILITIES)
                )

                raise InvalidParameterVisibility(
                    f"Unsupported visibility "
                    f"{visibility!r}. Allowed values: "
                    f"{allowed}, or None"
                )

        if not isinstance(self.readonly, bool):
            raise TypeError(
                "readonly must be a boolean"
            )

        if not isinstance(self.optional, bool):
            raise TypeError(
                "optional must be a boolean"
            )

        default = self.default

        if default is not None:
            default = _validate_non_empty_string(
                default,
                "default",
            )

        if self.optional and default is not None:
            raise InvalidParameterConfiguration(
                "A TypeScript parameter cannot be both "
                "optional and initialized with a default value"
            )

        decorators = _normalize_decorators(
            self.decorators
        )

        object.__setattr__(self, "name", name)
        object.__setattr__(
            self,
            "type",
            parameter_type,
        )
        object.__setattr__(
            self,
            "visibility",
            visibility,
        )
        object.__setattr__(
            self,
            "default",
            default,
        )
        object.__setattr__(
            self,
            "decorators",
            decorators,
        )

    @property
    def is_parameter_property(self) -> bool:
        """
        Whether the parameter declares a TypeScript class property.

        Constructor parameters with visibility or readonly modifiers
        are parameter properties.
        """

        return (
            self.visibility is not None
            or self.readonly
        )

    def render_typescript(self) -> str:
        return render_typescript_constructor_parameter(
            self
        )


def render_typescript_constructor_parameter(
    parameter: ConstructorParameter,
) -> str:
    """
    Render ConstructorParameter as a TypeScript constructor parameter.

    Example:

        ConstructorParameter(
            name="config",
            type="ConfigService",
        )

    becomes:

        private readonly config: ConfigService
    """

    if not isinstance(
        parameter,
        ConstructorParameter,
    ):
        raise TypeError(
            "parameter must be a ConstructorParameter"
        )

    parts: list[str] = []

    parts.extend(parameter.decorators)

    if parameter.visibility is not None:
        parts.append(parameter.visibility)

    if parameter.readonly:
        parts.append("readonly")

    parameter_name = parameter.name

    if parameter.optional:
        parameter_name += "?"

    parts.append(
        f"{parameter_name}: {parameter.type}"
    )

    rendered = " ".join(parts)

    if parameter.default is not None:
        rendered += f" = {parameter.default}"

    return rendered
