from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "010A",
    "name": "Constructor Parameter IR",
    "version": "1.0.0",
    "requires": ["009B"],
    "description": (
        "Adds the Atlas ConstructorParameter intermediate "
        "representation and TypeScript renderer."
    ),
    "build": [
        [
            "python3",
            "-m",
            "unittest",
            "tools.tests.test_constructor_parameter",
        ],
    ],
}


CONSTRUCTOR_PARAMETER_SOURCE = r'''from __future__ import annotations

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
'''.strip() + "\n"


TEST_SOURCE = r'''from __future__ import annotations

import unittest

from tools.modifier.constructor_parameter import (
    ConstructorParameter,
    InvalidParameterConfiguration,
    InvalidParameterName,
    InvalidParameterType,
    InvalidParameterVisibility,
    render_typescript_constructor_parameter,
)


class ConstructorParameterTests(unittest.TestCase):
    def test_default_private_readonly_parameter(self) -> None:
        parameter = ConstructorParameter(
            name="config",
            type="ConfigService",
        )

        self.assertEqual(
            parameter.render_typescript(),
            (
                "private readonly "
                "config: ConfigService"
            ),
        )

    def test_public_parameter(self) -> None:
        parameter = ConstructorParameter(
            name="logger",
            type="Logger",
            visibility="public",
            readonly=False,
        )

        self.assertEqual(
            parameter.render_typescript(),
            "public logger: Logger",
        )

    def test_protected_readonly_parameter(self) -> None:
        parameter = ConstructorParameter(
            name="repository",
            type="UserRepository",
            visibility="protected",
            readonly=True,
        )

        self.assertEqual(
            parameter.render_typescript(),
            (
                "protected readonly "
                "repository: UserRepository"
            ),
        )

    def test_plain_parameter_without_property_modifiers(
        self,
    ) -> None:
        parameter = ConstructorParameter(
            name="value",
            type="string",
            visibility=None,
            readonly=False,
        )

        self.assertEqual(
            parameter.render_typescript(),
            "value: string",
        )

        self.assertFalse(
            parameter.is_parameter_property
        )

    def test_optional_parameter(self) -> None:
        parameter = ConstructorParameter(
            name="options",
            type="AtlasOptions",
            visibility=None,
            readonly=False,
            optional=True,
        )

        self.assertEqual(
            parameter.render_typescript(),
            "options?: AtlasOptions",
        )

    def test_default_value(self) -> None:
        parameter = ConstructorParameter(
            name="enabled",
            type="boolean",
            visibility=None,
            readonly=False,
            default="true",
        )

        self.assertEqual(
            parameter.render_typescript(),
            "enabled: boolean = true",
        )

    def test_generic_and_union_type(self) -> None:
        parameter = ConstructorParameter(
            name="cache",
            type="Map<string, number> | null",
        )

        self.assertEqual(
            parameter.render_typescript(),
            (
                "private readonly cache: "
                "Map<string, number> | null"
            ),
        )

    def test_single_decorator(self) -> None:
        parameter = ConstructorParameter(
            name="repository",
            type="Repository<User>",
            decorators=(
                "@InjectRepository(User)",
            ),
        )

        self.assertEqual(
            parameter.render_typescript(),
            (
                "@InjectRepository(User) "
                "private readonly repository: "
                "Repository<User>"
            ),
        )

    def test_decorator_prefix_is_added(self) -> None:
        parameter = ConstructorParameter(
            name="token",
            type="string",
            decorators=(
                "Inject(ATLAS_TOKEN)",
            ),
        )

        self.assertEqual(
            parameter.render_typescript(),
            (
                "@Inject(ATLAS_TOKEN) "
                "private readonly token: string"
            ),
        )

    def test_multiple_decorators(self) -> None:
        parameter = ConstructorParameter(
            name="service",
            type="AtlasService",
            decorators=(
                "@Optional()",
                "@Inject(AtlasService)",
            ),
        )

        self.assertEqual(
            parameter.render_typescript(),
            (
                "@Optional() "
                "@Inject(AtlasService) "
                "private readonly service: "
                "AtlasService"
            ),
        )

    def test_parameter_property_detection(self) -> None:
        private_parameter = ConstructorParameter(
            name="config",
            type="ConfigService",
        )

        readonly_parameter = ConstructorParameter(
            name="value",
            type="string",
            visibility=None,
            readonly=True,
        )

        self.assertTrue(
            private_parameter.is_parameter_property
        )

        self.assertTrue(
            readonly_parameter.is_parameter_property
        )

    def test_invalid_parameter_name(self) -> None:
        with self.assertRaises(
            InvalidParameterName
        ):
            ConstructorParameter(
                name="atlas-brain",
                type="AtlasBrainService",
            )

    def test_empty_parameter_name(self) -> None:
        with self.assertRaises(ValueError):
            ConstructorParameter(
                name=" ",
                type="AtlasBrainService",
            )

    def test_empty_parameter_type(self) -> None:
        with self.assertRaises(ValueError):
            ConstructorParameter(
                name="atlasBrain",
                type=" ",
            )

    def test_invalid_visibility(self) -> None:
        with self.assertRaises(
            InvalidParameterVisibility
        ):
            ConstructorParameter(
                name="config",
                type="ConfigService",
                visibility="internal",
            )

    def test_optional_and_default_conflict(self) -> None:
        with self.assertRaises(
            InvalidParameterConfiguration
        ):
            ConstructorParameter(
                name="enabled",
                type="boolean",
                visibility=None,
                readonly=False,
                optional=True,
                default="true",
            )

    def test_decorators_cannot_be_single_string(
        self,
    ) -> None:
        with self.assertRaises(TypeError):
            ConstructorParameter(
                name="service",
                type="AtlasService",
                decorators="@Inject(AtlasService)",
            )

    def test_renderer_rejects_wrong_object(self) -> None:
        with self.assertRaises(TypeError):
            render_typescript_constructor_parameter(
                "config"
            )

    def test_input_values_are_normalized(self) -> None:
        parameter = ConstructorParameter(
            name="  config  ",
            type="  ConfigService  ",
            visibility=" PRIVATE ",
            default=None,
        )

        self.assertEqual(
            parameter.name,
            "config",
        )

        self.assertEqual(
            parameter.type,
            "ConfigService",
        )

        self.assertEqual(
            parameter.visibility,
            "private",
        )


if __name__ == "__main__":
    unittest.main()
'''.strip() + "\n"


EXPORT_BLOCK = r'''from .constructor_parameter import (
    ConstructorParameter,
    ConstructorParameterError,
    InvalidParameterConfiguration,
    InvalidParameterName,
    InvalidParameterType,
    InvalidParameterVisibility,
    render_typescript_constructor_parameter,
)'''


def apply(context: PatchContext) -> None:
    context.write_text(
        "tools/modifier/constructor_parameter.py",
        CONSTRUCTOR_PARAMETER_SOURCE,
    )

    context.write_text(
        "tools/tests/test_constructor_parameter.py",
        TEST_SOURCE,
    )

    context.append_once(
        "tools/modifier/__init__.py",
        EXPORT_BLOCK,
    )
