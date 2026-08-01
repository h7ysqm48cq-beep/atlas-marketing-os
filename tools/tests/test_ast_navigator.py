from __future__ import annotations

import unittest
from dataclasses import dataclass

from tools.modifier.ast_navigator import (
    ASTNavigator,
    ASTNodeAmbiguous,
    ASTNodeNotFound,
    InvalidASTStructure,
)


def create_bridge_result() -> dict:
    return {
        "classes": [
            {
                "name": "AppService",
                "start": 0,
                "end": 180,
                "constructors": [
                    {
                        "start": 28,
                        "end": 150,
                        "bodyStart": 140,
                        "bodyEnd": 148,
                        "parameters": [
                            {
                                "name": "config",
                                "type": "ConfigService",
                                "start": 50,
                                "end": 88,
                                "modifiers": [
                                    "private",
                                    "readonly",
                                ],
                                "decorators": [],
                            },
                            {
                                "name": "logger",
                                "type": "Logger",
                                "start": 94,
                                "end": 125,
                                "modifiers": [
                                    "private",
                                    "readonly",
                                ],
                                "decorators": [],
                            },
                        ],
                    }
                ],
            }
        ]
    }


class ASTNavigatorTests(unittest.TestCase):
    def test_get_only_class_without_name(self) -> None:
        navigator = ASTNavigator(
            create_bridge_result()
        )

        class_node = navigator.class_()

        self.assertEqual(
            class_node.name,
            "AppService",
        )

    def test_get_class_by_name(self) -> None:
        navigator = ASTNavigator(
            create_bridge_result()
        )

        class_node = navigator.class_(
            "AppService"
        )

        self.assertEqual(
            class_node.start,
            0,
        )

        self.assertEqual(
            class_node.end,
            180,
        )

    def test_missing_class_raises(self) -> None:
        navigator = ASTNavigator(
            create_bridge_result()
        )

        with self.assertRaises(
            ASTNodeNotFound
        ):
            navigator.class_(
                "MissingService"
            )

    def test_optional_missing_class(self) -> None:
        navigator = ASTNavigator(
            create_bridge_result()
        )

        self.assertIsNone(
            navigator.class_(
                "MissingService",
                required=False,
            )
        )

    def test_has_class(self) -> None:
        navigator = ASTNavigator(
            create_bridge_result()
        )

        self.assertTrue(
            navigator.has_class(
                "AppService"
            )
        )

        self.assertFalse(
            navigator.has_class(
                "MissingService"
            )
        )

    def test_unnamed_lookup_is_ambiguous(self) -> None:
        result = create_bridge_result()

        result["classes"].append(
            {
                "name": "OtherService",
                "start": 181,
                "end": 240,
                "constructors": [],
            }
        )

        navigator = ASTNavigator(result)

        with self.assertRaises(
            ASTNodeAmbiguous
        ):
            navigator.class_()

    def test_constructor_lookup(self) -> None:
        navigator = ASTNavigator(
            create_bridge_result()
        )

        constructor = (
            navigator
            .class_("AppService")
            .constructor()
        )

        self.assertEqual(
            constructor.start,
            28,
        )

        self.assertEqual(
            constructor.body_start,
            140,
        )

    def test_missing_constructor_raises(self) -> None:
        navigator = ASTNavigator(
            {
                "classes": [
                    {
                        "name": "EmptyService",
                        "start": 0,
                        "end": 30,
                        "constructors": [],
                    }
                ]
            }
        )

        class_node = navigator.class_(
            "EmptyService"
        )

        self.assertFalse(
            class_node.has_constructor()
        )

        with self.assertRaises(
            ASTNodeNotFound
        ):
            class_node.constructor()

    def test_parameters(self) -> None:
        constructor = (
            ASTNavigator(
                create_bridge_result()
            )
            .class_("AppService")
            .constructor()
        )

        parameters = constructor.parameters()

        self.assertEqual(
            len(parameters),
            2,
        )

        self.assertEqual(
            parameters[0].name,
            "config",
        )

        self.assertEqual(
            parameters[1].type,
            "Logger",
        )

    def test_find_parameter(self) -> None:
        constructor = (
            ASTNavigator(
                create_bridge_result()
            )
            .class_("AppService")
            .constructor()
        )

        parameter = constructor.parameter(
            "logger"
        )

        self.assertEqual(
            parameter.start,
            94,
        )

        self.assertEqual(
            parameter.end,
            125,
        )

    def test_has_parameter(self) -> None:
        constructor = (
            ASTNavigator(
                create_bridge_result()
            )
            .class_("AppService")
            .constructor()
        )

        self.assertTrue(
            constructor.has_parameter(
                "config"
            )
        )

        self.assertFalse(
            constructor.has_parameter(
                "missing"
            )
        )

    def test_first_and_last_parameter(self) -> None:
        constructor = (
            ASTNavigator(
                create_bridge_result()
            )
            .class_("AppService")
            .constructor()
        )

        self.assertEqual(
            constructor.first_parameter().name,
            "config",
        )

        self.assertEqual(
            constructor.last_parameter().name,
            "logger",
        )

    def test_empty_parameter_list(self) -> None:
        result = create_bridge_result()

        result["classes"][0][
            "constructors"
        ][0]["parameters"] = []

        constructor = (
            ASTNavigator(result)
            .class_("AppService")
            .constructor()
        )

        self.assertEqual(
            constructor.parameters(),
            (),
        )

        self.assertIsNone(
            constructor.first_parameter()
        )

        self.assertIsNone(
            constructor.last_parameter()
        )

    def test_parameter_modifiers(self) -> None:
        constructor = (
            ASTNavigator(
                create_bridge_result()
            )
            .class_("AppService")
            .constructor()
        )

        parameter = constructor.parameter(
            "config"
        )

        self.assertEqual(
            parameter.modifiers,
            (
                "private",
                "readonly",
            ),
        )

    def test_object_bridge_result_is_supported(
        self,
    ) -> None:
        @dataclass
        class Result:
            classes: list[dict]

        source = create_bridge_result()

        navigator = ASTNavigator(
            Result(
                classes=source["classes"]
            )
        )

        self.assertEqual(
            navigator.class_().name,
            "AppService",
        )

    def test_invalid_classes_structure(self) -> None:
        navigator = ASTNavigator(
            {
                "classes": "not-a-list",
            }
        )

        with self.assertRaises(
            InvalidASTStructure
        ):
            navigator.classes()

    def test_invalid_position_structure(self) -> None:
        result = create_bridge_result()

        result["classes"][0]["start"] = "zero"

        class_node = ASTNavigator(
            result
        ).class_()

        with self.assertRaises(
            InvalidASTStructure
        ):
            _ = class_node.start

    def test_duplicate_class_names_are_ambiguous(
        self,
    ) -> None:
        result = create_bridge_result()

        result["classes"].append(
            {
                "name": "AppService",
                "start": 181,
                "end": 240,
                "constructors": [],
            }
        )

        navigator = ASTNavigator(result)

        with self.assertRaises(
            ASTNodeAmbiguous
        ):
            navigator.class_(
                "AppService"
            )


if __name__ == "__main__":
    unittest.main()
