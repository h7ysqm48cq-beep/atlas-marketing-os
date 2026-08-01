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


class TestMethodUpdate:
    def test_update_method(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method.ts",
            """class UserService {
  login(): boolean {
    return false;
  }

  test(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_method(
            "UserService",
            "login",
            parameters="username: string",
            return_type="boolean",
            body="return Boolean(username);",
            decorators=[
                "Log()",
                "Trace()",
            ],
            modifiers=[
                "public",
                "async",
            ],
        )

        output = file.source()

        assert "@Log()" in output
        assert "@Trace()" in output

        assert (
            "public async login("
            "username: string"
            "): boolean"
            in output
        )

        assert (
            "return Boolean(username);"
            in output
        )

        assert "test(): void" in output

    def test_multiline_method_body(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "multiline.ts",
            """class Calculator {
  sum(values: number[]): number {
    return 0;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_method(
            "Calculator",
            "sum",
            parameters="values: number[]",
            return_type="number",
            body="""if (values.length === 0) {
  return 0;
}

return values.reduce(
  (total, value) => total + value,
  0,
);""",
        )

        output = file.source()

        assert (
            "if (values.length === 0)"
            in output
        )

        assert (
            "return values.reduce("
            in output
        )

    def test_method_comment_preserved(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method-comment.ts",
            """class UserService {
  // Keep this comment.
  login(): boolean {
    return false;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_method(
            "UserService",
            "login",
            return_type="boolean",
            body="return true;",
        )

        output = file.source()

        assert "// Keep this comment." in output
        assert "return true;" in output

    def test_method_utf16(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method-utf16.ts",
            """class EmojiService {
  message = "😀";

  describe(): string {
    return "old";
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_method(
            "EmojiService",
            "describe",
            return_type="string",
            body='return "测试🚀";',
        )

        output = file.source()

        assert 'message = "😀";' in output
        assert 'return "测试🚀";' in output


class TestPropertyUpdate:
    def test_update_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property.ts",
            """class UserService {
  active = false;

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_property(
            "UserService",
            "active",
            type_annotation="boolean",
            initializer="true",
            decorators="Inject()",
            modifiers=[
                "private",
                "readonly",
            ],
        )

        output = file.source()

        assert "@Inject()" in output

        assert (
            "private readonly active: "
            "boolean = true;"
            in output
        )

        assert "run(): void" in output

    def test_update_optional_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-optional.ts",
            """class UserService {
  label: string;
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_property(
            "UserService",
            "label",
            type_annotation="string",
            optional=True,
        )

        assert (
            "label?: string;"
            in file.source()
        )

    def test_update_definite_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-definite.ts",
            """class UserService {
  client: ApiClient;
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_property(
            "UserService",
            "client",
            type_annotation="ApiClient",
            definite=True,
        )

        assert (
            "client!: ApiClient;"
            in file.source()
        )

    def test_optional_and_definite_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-invalid.ts",
            """class UserService {
  client: ApiClient;
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="cannot both be true",
        ):
            file.update_property(
                "UserService",
                "client",
                type_annotation="ApiClient",
                optional=True,
                definite=True,
            )

    def test_property_utf16(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-utf16.ts",
            """class MessageService {
  message = "😀";

  finish = "结束";
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_property(
            "MessageService",
            "message",
            initializer='"测试🚀"',
        )

        output = file.source()

        assert 'message = "测试🚀";' in output
        assert 'finish = "结束";' in output


class TestAccessorUpdate:
    def test_update_getter_only(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "getter.ts",
            """class UserService {
  private value = false;

  get active(): boolean {
    return this.value;
  }

  set active(value: boolean) {
    this.value = value;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_getter(
            "UserService",
            "active",
            return_type="boolean",
            body="return true;",
            modifiers="public",
        )

        output = file.source()

        assert """public get active(): boolean {
    return true;
  }""" in output

        assert (
            "set active(value: boolean)"
            in output
        )

    def test_update_setter_only(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "setter.ts",
            """class UserService {
  private value = false;

  get active(): boolean {
    return this.value;
  }

  set active(value: boolean) {
    this.value = value;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_setter(
            "UserService",
            "active",
            parameter="enabled: boolean",
            body="this.value = enabled;",
            modifiers="public",
        )

        output = file.source()

        assert (
            "get active(): boolean"
            in output
        )

        assert """public set active(enabled: boolean) {
    this.value = enabled;
  }""" in output

    def test_generic_accessor_ambiguity(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "accessor-ambiguity.ts",
            """class UserService {
  get active(): boolean {
    return true;
  }

  set active(value: boolean) {
    void value;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="more than one member",
        ):
            file.update_member(
                "UserService",
                "active",
                """get active(): boolean {
  return false;
}""",
            )


class TestConstructorUpdate:
    def test_update_constructor(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "constructor.ts",
            """class UserService {
  private enabled = false;

  constructor() {}

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_constructor(
            "UserService",
            parameters=(
                "private readonly name: string"
            ),
            body="""this.enabled = true;
console.log(name);""",
            modifiers="public",
        )

        output = file.source()

        assert """public constructor(private readonly name: string) {
    this.enabled = true;
    console.log(name);
  }""" in output

        assert output.index(
            "private enabled"
        ) < output.index(
            "constructor"
        ) < output.index(
            "run(): void"
        )

    def test_missing_constructor_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing-constructor.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.update_constructor(
                "UserService",
            )
            is False
        )


class TestGenericMemberUpdate:
    def test_update_member_text(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "generic.ts",
            """class UserService {
  login(): boolean {
    return false;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_member(
            "UserService",
            "login",
            """@Log()
public login(): boolean {
  return true;
}""",
            kind="method",
        )

        output = file.source()

        assert "@Log()" in output
        assert "public login(): boolean" in output
        assert "return true;" in output

    def test_kind_mismatch_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "kind-mismatch.ts",
            """class UserService {
  active: boolean;
}
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="kind does not match",
        ):
            file.update_member(
                "UserService",
                "active",
                "active(): boolean { return true; }",
                kind="property",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    def test_name_mismatch_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "name-mismatch.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="name does not match",
        ):
            file.update_member(
                "UserService",
                "login",
                "authenticate(): void {}",
                kind="method",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    @pytest.mark.parametrize(
        "replacement_text",
        [
            "",
            (
                "login(): void {}\n"
                "logout(): void {}"
            ),
            "login(",
        ],
    )
    def test_invalid_replacement_rejected(
        self,
        temp_workspace: Path,
        replacement_text: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        expected_exception = (
            ValueError
            if replacement_text == ""
            else UnsupportedTypeScriptImport
        )

        with pytest.raises(
            expected_exception,
        ):
            file.update_member(
                "UserService",
                "login",
                replacement_text,
                kind="method",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    def test_missing_member_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing-member.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.update_method(
                "UserService",
                "missing",
            )
            is False
        )

    def test_missing_class_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing-class.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.update_method(
                "MissingService",
                "login",
            )
            is False
        )

    def test_idempotent_update(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "idempotent.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.update_method(
                "UserService",
                "login",
                return_type="void",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_logging_and_dirty_tracking(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_method(
            "UserService",
            "login",
            return_type="boolean",
            body="return true;",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "update_member"
        )

        assert (
            operation["class_name"]
            == "UserService"
        )

        assert (
            operation["member_name"]
            == "login"
        )

        assert operation["kind"] == "method"

        assert (
            operation["engine"]
            == "typescript_ast"
        )

    def test_whitespace_stability(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "whitespace.ts",
            """class UserService {
  first(): void {}

  second(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.update_method(
            "UserService",
            "second",
            return_type="void",
            body="return;",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")

        assert output.index(
            "first(): void"
        ) < output.index(
            "second(): void"
        ) < output.index(
            "third(): void"
        )
