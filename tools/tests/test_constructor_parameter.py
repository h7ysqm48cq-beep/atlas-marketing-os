from __future__ import annotations

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
