from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "010B",
    "name": "TypeScript AST Navigator",
    "version": "1.0.0",
    "requires": ["010A"],
    "description": (
        "Adds reusable navigation helpers for classes, constructors "
        "and parameters returned by TypeScriptBridge."
    ),
    "build": [
        [
            "python3",
            "-m",
            "unittest",
            "tools.tests.test_ast_navigator",
        ],
    ],
}


AST_NAVIGATOR_SOURCE = r'''from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Iterator


class ASTNavigatorError(RuntimeError):
    """Base error raised by the AST navigation layer."""


class InvalidASTStructure(ASTNavigatorError):
    """Raised when bridge data has an unexpected structure."""


class ASTNodeNotFound(ASTNavigatorError):
    """Raised when a requested AST node cannot be found."""


class ASTNodeAmbiguous(ASTNavigatorError):
    """Raised when more than one node matches a lookup."""


def _read_field(
    value: Any,
    field_name: str,
    default: Any = None,
) -> Any:
    """
    Read a field from either a mapping or an object.

    TypeScriptBridge currently returns a BridgeResult object containing
    dictionaries, but supporting both forms keeps the navigator reusable.
    """

    if isinstance(value, Mapping):
        return value.get(field_name, default)

    return getattr(value, field_name, default)


def _as_node_sequence(
    value: Any,
    field_name: str,
) -> tuple[Any, ...]:
    if value is None:
        return ()

    if isinstance(value, (str, bytes)):
        raise InvalidASTStructure(
            f"{field_name} must be a sequence of AST nodes"
        )

    if not isinstance(value, Sequence):
        raise InvalidASTStructure(
            f"{field_name} must be a sequence of AST nodes"
        )

    return tuple(value)


def _required_integer(
    node: Any,
    field_name: str,
) -> int:
    value = _read_field(node, field_name)

    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidASTStructure(
            f"AST field {field_name!r} must be an integer"
        )

    return value


@dataclass(frozen=True, slots=True)
class ParameterNode:
    raw: Any

    @property
    def name(self) -> str | None:
        value = _read_field(self.raw, "name")

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Parameter name must be a string"
            )

        return value

    @property
    def type(self) -> str | None:
        value = _read_field(self.raw, "type")

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Parameter type must be a string"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def modifiers(self) -> tuple[str, ...]:
        values = _read_field(
            self.raw,
            "modifiers",
            (),
        )

        if values is None:
            return ()

        if isinstance(values, (str, bytes)):
            raise InvalidASTStructure(
                "Parameter modifiers must be a sequence"
            )

        return tuple(values)

    @property
    def decorators(self) -> tuple[Any, ...]:
        values = _read_field(
            self.raw,
            "decorators",
            (),
        )

        return _as_node_sequence(
            values,
            "parameter.decorators",
        )


@dataclass(frozen=True, slots=True)
class ConstructorNode:
    raw: Any

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def body_start(self) -> int:
        return _required_integer(
            self.raw,
            "bodyStart",
        )

    @property
    def body_end(self) -> int:
        return _required_integer(
            self.raw,
            "bodyEnd",
        )

    def parameters(self) -> tuple[ParameterNode, ...]:
        values = _read_field(
            self.raw,
            "parameters",
            (),
        )

        return tuple(
            ParameterNode(raw=node)
            for node in _as_node_sequence(
                values,
                "constructor.parameters",
            )
        )

    def parameter(
        self,
        name: str,
        *,
        required: bool = True,
    ) -> ParameterNode | None:
        if not isinstance(name, str):
            raise TypeError(
                "parameter name must be a string"
            )

        normalized = name.strip()

        if not normalized:
            raise ValueError(
                "parameter name cannot be empty"
            )

        matches = [
            parameter
            for parameter in self.parameters()
            if parameter.name == normalized
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one constructor parameter "
                f"named {normalized!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"Constructor parameter "
                f"{normalized!r} was not found"
            )

        return None

    def has_parameter(
        self,
        name: str,
    ) -> bool:
        return (
            self.parameter(
                name,
                required=False,
            )
            is not None
        )

    def first_parameter(
        self,
    ) -> ParameterNode | None:
        parameters = self.parameters()

        if not parameters:
            return None

        return parameters[0]

    def last_parameter(
        self,
    ) -> ParameterNode | None:
        parameters = self.parameters()

        if not parameters:
            return None

        return parameters[-1]


@dataclass(frozen=True, slots=True)
class ClassNode:
    raw: Any

    @property
    def name(self) -> str | None:
        value = _read_field(self.raw, "name")

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Class name must be a string"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    def constructors(
        self,
    ) -> tuple[ConstructorNode, ...]:
        values = _read_field(
            self.raw,
            "constructors",
            (),
        )

        return tuple(
            ConstructorNode(raw=node)
            for node in _as_node_sequence(
                values,
                "class.constructors",
            )
        )

    def constructor(
        self,
        *,
        required: bool = True,
    ) -> ConstructorNode | None:
        constructors = self.constructors()

        if len(constructors) > 1:
            raise ASTNodeAmbiguous(
                f"Class {self.name!r} contains more than "
                "one constructor"
            )

        if constructors:
            return constructors[0]

        if required:
            raise ASTNodeNotFound(
                f"Class {self.name!r} does not contain "
                "a constructor"
            )

        return None

    def has_constructor(self) -> bool:
        return (
            self.constructor(required=False)
            is not None
        )


class ASTNavigator:
    """
    Read-only navigator for TypeScriptBridge output.

    Example:

        navigator = ASTNavigator(result)

        constructor = (
            navigator
            .class_("AppService")
            .constructor()
        )

        last_parameter = constructor.last_parameter()
    """

    def __init__(
        self,
        bridge_result: Any,
    ) -> None:
        if bridge_result is None:
            raise TypeError(
                "bridge_result cannot be None"
            )

        self.bridge_result = bridge_result

    def _class_values(self) -> tuple[Any, ...]:
        values = _read_field(
            self.bridge_result,
            "classes",
            (),
        )

        return _as_node_sequence(
            values,
            "bridge_result.classes",
        )

    def classes(self) -> tuple[ClassNode, ...]:
        return tuple(
            ClassNode(raw=node)
            for node in self._class_values()
        )

    def iter_classes(self) -> Iterator[ClassNode]:
        return iter(self.classes())

    def class_(
        self,
        name: str | None = None,
        *,
        required: bool = True,
    ) -> ClassNode | None:
        """
        Locate a class by name.

        When name is None, the result must contain exactly one class.
        This is convenient for single-class TypeScript files.
        """

        classes = self.classes()

        if name is None:
            if len(classes) > 1:
                raise ASTNodeAmbiguous(
                    "More than one class exists; "
                    "provide a class name"
                )

            if classes:
                return classes[0]

            if required:
                raise ASTNodeNotFound(
                    "No TypeScript class was found"
                )

            return None

        if not isinstance(name, str):
            raise TypeError(
                "class name must be a string or None"
            )

        normalized = name.strip()

        if not normalized:
            raise ValueError(
                "class name cannot be empty"
            )

        matches = [
            class_node
            for class_node in classes
            if class_node.name == normalized
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one class named "
                f"{normalized!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"TypeScript class "
                f"{normalized!r} was not found"
            )

        return None

    def has_class(
        self,
        name: str,
    ) -> bool:
        return (
            self.class_(
                name,
                required=False,
            )
            is not None
        )
'''.strip() + "\n"


TEST_SOURCE = r'''from __future__ import annotations

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
'''.strip() + "\n"


EXPORT_BLOCK = r'''from .ast_navigator import (
    ASTNavigator,
    ASTNavigatorError,
    ASTNodeAmbiguous,
    ASTNodeNotFound,
    ClassNode,
    ConstructorNode,
    InvalidASTStructure,
    ParameterNode,
)'''


def apply(context: PatchContext) -> None:
    context.write_text(
        "tools/modifier/ast_navigator.py",
        AST_NAVIGATOR_SOURCE,
    )

    context.write_text(
        "tools/tests/test_ast_navigator.py",
        TEST_SOURCE,
    )

    context.append_once(
        "tools/modifier/__init__.py",
        EXPORT_BLOCK,
    )
