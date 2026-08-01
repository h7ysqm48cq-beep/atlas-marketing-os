from __future__ import annotations

from pathlib import Path

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    filename: str,
    source: str,
) -> Path:
    path = workspace / filename

    path.write_text(
        source,
        encoding="utf-8",
    )

    return path


class TestClassUpdate:
    def test_update_class_body(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "class-update.ts",
            """// Keep this comment.
@Old()
export class UserService {
  run(): void {}
}

class AdminService {}
""",
        )

        file = TypeScriptFile.load(path)

        changed = file.update_class(
            "UserService",
            body="""login(): boolean {
  return true;
}""",
        )

        assert changed is True

        output = file.source()

        assert "// Keep this comment." in output
        assert "@Old()" not in output

        assert """class UserService {
  login(): boolean {
    return true;
  }
}""" in output

        assert "class AdminService {}" in output

    def test_update_class_heritage(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "class-heritage.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.update_class(
            "UserService",
            extends="BaseService",
            implements=[
                "OnModuleInit",
                "Disposable",
            ],
            modifiers=[
                "export",
                "default",
            ],
        )

        assert (
            "export default class UserService "
            "extends BaseService implements "
            "OnModuleInit, Disposable"
            in file.source()
        )

    def test_update_class_text_name_mismatch(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "class-mismatch.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="does not match",
        ):
            file.update_class_text(
                "UserService",
                "class AccountService {}",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    @pytest.mark.parametrize(
        "replacement",
        [
            "function UserService() {}",
            "class UserService {",
            (
                "class UserService {}\n\n"
                "class Other {}"
            ),
        ],
    )
    def test_invalid_class_replacement(
        self,
        temp_workspace: Path,
        replacement: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-class-update.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
        ):
            file.update_class_text(
                "UserService",
                replacement,
            )

    def test_class_update_is_idempotent(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "class-idempotent.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.update_class(
                "UserService",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False


class TestFunctionUpdate:
    def test_update_function_signature_and_body(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "function-update.ts",
            """// Keep this comment.
export function calculate(
  value: number
): number {
  return value;
}

function finish(): string {
  return "done";
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_function(
            "calculate",
            parameters=(
                "left: number, "
                "right: number"
            ),
            return_type="number",
            body="return left + right;",
            modifiers="export",
        )

        output = file.source()

        assert "// Keep this comment." in output

        assert (
            "export function calculate("
            "left: number, right: number"
            "): number"
            in output
        )

        assert "return left + right;" in output
        assert "function finish(): string" in output

    def test_update_generic_function(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "generic-function.ts",
            "function identity(value: unknown) {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.update_function(
            "identity",
            type_parameters="T",
            parameters="value: T",
            return_type="T",
            body="return value;",
            modifiers="export",
        )

        assert (
            "export function identity<T>"
            "(value: T): T"
            in file.source()
        )

    def test_update_generator_function(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "generator-function.ts",
            "function numbers(): void {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.update_function(
            "numbers",
            return_type=(
                "Generator<number, void, unknown>"
            ),
            body="""yield 1;
yield 2;""",
            generator=True,
        )

        output = file.source()

        assert (
            "function* numbers(): "
            "Generator<number, void, unknown>"
            in output
        )

        assert "yield 1;" in output
        assert "yield 2;" in output

    def test_function_update_name_mismatch(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "function-mismatch.ts",
            "function calculate() {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="does not match",
        ):
            file.update_function_text(
                "calculate",
                "function total() {}",
            )

    def test_missing_function_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing-function.ts",
            "function calculate() {}\n",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.update_function(
                "missing",
            )
            is False
        )


class TestInterfaceUpdate:
    def test_update_interface_body(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "interface-update.ts",
            """// Keep this comment.
export interface User {
  id: string;
}

interface Account {
  balance: number;
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_interface(
            "User",
            body="""id: string;
name: string;""",
            modifiers="export",
        )

        output = file.source()

        assert "// Keep this comment." in output

        assert """export interface User {
  id: string;
  name: string;
}""" in output

        assert "balance: number;" in output

    def test_update_interface_generic_and_extends(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "interface-generic.ts",
            "interface Result {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.update_interface(
            "Result",
            type_parameters="T",
            extends=[
                "BaseResult",
                "Serializable",
            ],
            body="data: T;",
            modifiers="export",
        )

        assert (
            "export interface Result<T> extends "
            "BaseResult, Serializable"
            in file.source()
        )

    def test_interface_name_mismatch(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "interface-mismatch.ts",
            "interface User {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="does not match",
        ):
            file.update_interface_text(
                "User",
                "interface Person {}",
            )


class TestTypeAliasUpdate:
    def test_update_union_type(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "type-update.ts",
            """// Keep this comment.
export type Status =
  | "pending"
  | "active";

type Result = {
  success: boolean;
};
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_type_alias(
            "Status",
            '"pending" | "active" | "done"',
            modifiers="export",
        )

        output = file.source()

        assert "// Keep this comment." in output

        assert (
            'export type Status = '
            '"pending" | "active" | "done";'
            in output
        )

        assert "type Result" in output

    def test_update_generic_mapped_type(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "mapped-type.ts",
            "type Shape = string;\n",
        )

        file = TypeScriptFile.load(path)

        assert file.update_type_alias(
            "Shape",
            """{
  readonly [K in keyof T]: T[K];
}""",
            type_parameters="T",
        )

        output = file.source()

        assert "type Shape<T> = {" in output

        assert (
            "readonly [K in keyof T]: T[K];"
            in output
        )

    def test_type_alias_name_mismatch(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "type-mismatch.ts",
            "type Status = string;\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="does not match",
        ):
            file.update_type_alias_text(
                "Status",
                "type State = string;",
            )


class TestEnumUpdate:
    def test_update_string_enum(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "enum-update.ts",
            """// Keep this comment.
export enum Status {
  Pending,
  Active,
}

enum Priority {
  Low,
  High,
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_enum(
            "Status",
            [
                'Pending = "pending"',
                'Active = "active"',
                'Done = "done"',
            ],
            modifiers="export",
        )

        output = file.source()

        assert "// Keep this comment." in output
        assert 'Done = "done",' in output
        assert "enum Priority" in output

    def test_update_const_enum(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "const-enum.ts",
            """enum Direction {
  Up,
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_enum(
            "Direction",
            [
                "Up",
                "Down",
            ],
            modifiers=[
                "export",
                "const",
            ],
        )

        assert (
            "export const enum Direction"
            in file.source()
        )

    def test_enum_name_mismatch(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "enum-mismatch.ts",
            "enum Status {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="does not match",
        ):
            file.update_enum_text(
                "Status",
                "enum State {}",
            )


class TestVariableUpdate:
    def test_update_variable(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "variable-update.ts",
            """// Keep this comment.
export const value: number = 1;

let message = "hello";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_variable(
            "value",
            type_annotation="number",
            initializer="2",
            modifiers="export",
        )

        output = file.source()

        assert "// Keep this comment." in output

        assert (
            "export const value: number = 2;"
            in output
        )

        assert 'let message = "hello";' in output

    def test_update_variable_kind(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "variable-kind.ts",
            "const value = 1;\n",
        )

        file = TypeScriptFile.load(path)

        assert file.update_variable(
            "value",
            declaration_kind="let",
            type_annotation="number",
        )

        assert (
            "let value: number;"
            in file.source()
        )

    def test_variable_name_mismatch(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "variable-mismatch.ts",
            "const value = 1;\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="does not match",
        ):
            file.update_variable_text(
                "value",
                "const total = 2;",
            )

    @pytest.mark.parametrize(
        "replacement",
        [
            "const value = 2, other = 3;",
            "const { value } = source;",
            "function value() {}",
            "const value =",
        ],
    )
    def test_invalid_variable_replacement(
        self,
        temp_workspace: Path,
        replacement: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-variable-update.ts",
            "const value = 1;\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
        ):
            file.update_variable_text(
                "value",
                replacement,
            )

    def test_variable_update_utf16(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16-variable-update.ts",
            """const message = "😀";

const finish = "结束";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_variable(
            "message",
            initializer='"测试🚀"',
        )

        output = file.source()

        assert (
            'const message = "测试🚀";'
            in output
        )

        assert (
            'const finish = "结束";'
            in output
        )


class TestDeclarationUpdateLogging:
    @pytest.mark.parametrize(
        (
            "source",
            "operation",
            "expected_action",
        ),
        [
            (
                "class UserService {}\n",
                lambda file: file.update_class(
                    "UserService",
                    body="run(): void {}",
                ),
                "update_class",
            ),
            (
                "function run(): void {}\n",
                lambda file: file.update_function(
                    "run",
                    return_type="void",
                    body="return;",
                ),
                "update_function",
            ),
            (
                "interface User {}\n",
                lambda file: file.update_interface(
                    "User",
                    body="id: string;",
                ),
                "update_interface",
            ),
            (
                "type Status = string;\n",
                lambda file: file.update_type_alias(
                    "Status",
                    "number",
                ),
                "update_type_alias",
            ),
            (
                """enum Status {
  Active,
}
""",
                lambda file: file.update_enum(
                    "Status",
                    ["Inactive"],
                ),
                "update_enum",
            ),
            (
                "const value = 1;\n",
                lambda file: file.update_variable(
                    "value",
                    initializer="2",
                ),
                "update_variable",
            ),
        ],
    )
    def test_update_logging(
        self,
        temp_workspace: Path,
        source: str,
        operation,
        expected_action: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            (
                expected_action
                + ".ts"
            ),
            source,
        )

        file = TypeScriptFile.load(path)

        assert operation(file) is True
        assert file.dirty is True

        assert (
            file.operations[-1]["action"]
            == expected_action
        )

        assert (
            file.operations[-1]["engine"]
            == "typescript_ast"
        )

    def test_update_whitespace_stability(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "update-whitespace.ts",
            """class UserService {}

class AdminService {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_class(
            "UserService",
            body="run(): void {}",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
