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


class TestMethodAdd:
    def test_add_basic_method(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method-basic.ts",
            """class UserService {
  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_method(
            "UserService",
            "login",
            parameters="username: string",
            return_type="boolean",
            body="return Boolean(username);",
        )

        output = file.source()

        assert """login(username: string): boolean {
    return Boolean(username);
  }""" in output

    def test_add_decorated_async_method(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method-decorated.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_method(
            "UserService",
            "login",
            parameters="username: string",
            return_type="Promise<boolean>",
            body="return Boolean(username);",
            decorators=[
                "Log()",
                "@Trace()",
            ],
            modifiers=[
                "public",
                "async",
            ],
        )

        output = file.source()

        assert output.index(
            "@Log()"
        ) < output.index(
            "@Trace()"
        ) < output.index(
            "public async login"
        )

    def test_add_static_method(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method-static.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_method(
            "UserService",
            "create",
            return_type="UserService",
            body="return new UserService();",
            modifiers="static",
        )

        assert (
            "static create(): UserService"
            in file.source()
        )

    def test_add_method_before_target(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method-before.ts",
            """class UserService {
  first(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_method(
            "UserService",
            "second",
            before="third",
        )

        output = file.source()

        assert output.index(
            "first(): void"
        ) < output.index(
            "second()"
        ) < output.index(
            "third(): void"
        )

    def test_add_method_after_target(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method-after.ts",
            """class UserService {
  first(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_method(
            "UserService",
            "second",
            after="first",
        )

        output = file.source()

        assert output.index(
            "first(): void"
        ) < output.index(
            "second()"
        ) < output.index(
            "third(): void"
        )

    def test_duplicate_method_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method-duplicate.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="conflicting member",
        ):
            file.add_method(
                "UserService",
                "login",
            )


class TestPropertyAdd:
    def test_add_typed_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-typed.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_property(
            "UserService",
            "name",
            type_annotation="string",
        )

        assert (
            "name: string;"
            in file.source()
        )

    def test_add_initialized_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-initialized.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_property(
            "UserService",
            "active",
            type_annotation="boolean",
            initializer="true",
            modifiers=[
                "private",
                "readonly",
            ],
        )

        assert (
            "private readonly active: "
            "boolean = true;"
            in file.source()
        )

    def test_add_optional_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-optional.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_property(
            "UserService",
            "label",
            type_annotation="string",
            optional=True,
        )

        assert (
            "label?: string;"
            in file.source()
        )

    def test_add_definite_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-definite.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_property(
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
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="cannot both be true",
        ):
            file.add_property(
                "UserService",
                "client",
                type_annotation="ApiClient",
                optional=True,
                definite=True,
            )

    def test_decorated_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property-decorated.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_property(
            "UserService",
            "repository",
            type_annotation="Repository",
            decorators="Inject()",
            modifiers="private",
        )

        output = file.source()

        assert output.index(
            "@Inject()"
        ) < output.index(
            "private repository"
        )


class TestAccessorAdd:
    def test_add_getter(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "getter.ts",
            """class UserService {
  private value = false;
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_getter(
            "UserService",
            "active",
            return_type="boolean",
            body="return this.value;",
            modifiers="public",
        )

        assert """public get active(): boolean {
    return this.value;
  }""" in file.source()

    def test_add_setter(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "setter.ts",
            """class UserService {
  private value = false;
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_setter(
            "UserService",
            "active",
            parameter="value: boolean",
            body="this.value = value;",
            modifiers="public",
        )

        assert """public set active(value: boolean) {
    this.value = value;
  }""" in file.source()

    def test_getter_and_setter_pair_allowed(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "accessor-pair.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_getter(
            "UserService",
            "active",
            return_type="boolean",
            body="return true;",
        )

        assert file.add_setter(
            "UserService",
            "active",
            parameter="value: boolean",
            body="void value;",
        )

        output = file.source()

        assert "get active(): boolean" in output
        assert "set active(value: boolean)" in output

    def test_duplicate_getter_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "getter-duplicate.ts",
            """class UserService {
  get active(): boolean {
    return true;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="conflicting member",
        ):
            file.add_getter(
                "UserService",
                "active",
                return_type="boolean",
            )

    def test_empty_setter_parameter_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "setter-empty.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="parameter cannot be empty",
        ):
            file.add_setter(
                "UserService",
                "active",
                parameter="",
            )


class TestConstructorAdd:
    def test_add_constructor(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "constructor.ts",
            """class UserService {
  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_constructor(
            "UserService",
            parameters=(
                "private readonly name: string"
            ),
            body='console.log("created");',
            modifiers="public",
            position="top",
        )

        output = file.source()

        assert """public constructor(private readonly name: string) {
    console.log("created");
  }""" in output

        assert output.index(
            "constructor"
        ) < output.index(
            "run(): void"
        )

    def test_duplicate_constructor_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "constructor-duplicate.ts",
            """class UserService {
  constructor() {}
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="already contains a constructor",
        ):
            file.add_constructor(
                "UserService",
            )


class TestGenericMemberAdd:
    def test_add_member_text(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "generic.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_member(
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

    @pytest.mark.parametrize(
        "member_text",
        [
            "",
            "login(): void {}\nlogout(): void {}",
            "name: string;\nactive: boolean;",
        ],
    )
    def test_invalid_member_text_rejected(
        self,
        temp_workspace: Path,
        member_text: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-member.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        expected_exception = (
            ValueError
            if not member_text
            else UnsupportedTypeScriptImport
        )

        with pytest.raises(
            expected_exception,
        ):
            file.add_member(
                "UserService",
                "login",
                member_text,
                kind="method",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    def test_missing_class_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing-class.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.add_method(
                "MissingService",
                "login",
            )
            is False
        )

    def test_utf16_member_add(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16.ts",
            """class EmojiService {
  message = "😀";
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_method(
            "EmojiService",
            "describe",
            return_type="string",
            body='return "测试🚀";',
            position="top",
        )

        output = file.source()

        assert 'return "测试🚀";' in output
        assert 'message = "😀";' in output

    def test_member_add_logging(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_method(
            "UserService",
            "login",
            position="top",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert operation["action"] == (
            "add_member"
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
        assert operation["direction"] == "top"
        assert operation["target_name"] is None

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

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_method(
            "UserService",
            "second",
            before="third",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
