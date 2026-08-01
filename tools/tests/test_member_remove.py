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


class TestMemberRemove:
    def test_remove_method(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "method.ts",
            """class UserService {
  login(): boolean {
    return true;
  }

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "login",
            kind="method",
        )

        output = file.source()

        assert "login(): boolean" not in output
        assert "run(): void" in output

    def test_remove_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property.ts",
            """class UserService {
  active = true;

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "active",
            kind="property",
        )

        output = file.source()

        assert "active = true;" not in output
        assert "run(): void" in output

    def test_remove_constructor(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "constructor.ts",
            """class UserService {
  constructor(
    private readonly name: string,
  ) {}

  run(): string {
    return this.name;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "constructor",
            kind="constructor",
        )

        output = file.source()

        assert "constructor(" not in output
        assert "run(): string" in output

    def test_remove_getter_only(
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

        assert file.remove_member(
            "UserService",
            "active",
            kind="getter",
            force=True,
        )

        output = file.source()

        assert "get active()" not in output
        assert "set active(value: boolean)" in output

    def test_remove_setter_only(
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

        assert file.remove_member(
            "UserService",
            "active",
            kind="setter",
            force=True,
        )

        output = file.source()

        assert "get active(): boolean" in output
        assert "set active(value: boolean)" not in output

    def test_accessor_ambiguity_rejected(
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
            file.remove_member(
                "UserService",
                "active",
            )

    def test_referenced_member_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "referenced.ts",
            """class UserService {
  login(): boolean {
    return true;
  }

  test(): boolean {
    return this.login();
  }
}

const service = new UserService();
service.login();
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="reference",
        ):
            file.remove_member(
                "UserService",
                "login",
                kind="method",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    def test_force_remove_referenced_member(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "force.ts",
            """class UserService {
  login(): boolean {
    return true;
  }

  test(): boolean {
    return this.login();
  }
}

const service = new UserService();
service.login();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "login",
            kind="method",
            force=True,
        )

        output = file.source()

        assert "login(): boolean" not in output
        assert "return this.login();" in output
        assert "service.login();" in output

        operation = file.operations[-1]

        assert operation["forced"] is True
        assert operation["references"] == 2

    def test_comment_and_decorator_removed_together(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "attached.ts",
            """class UserService {
  // Login method.
  @Log()
  public login(): boolean {
    return true;
  }

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "login",
            kind="method",
        )

        output = file.source()

        assert "// Login method." not in output
        assert "@Log()" not in output
        assert "login(): boolean" not in output
        assert "run(): void" in output

    def test_block_comment_removed_together(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "block-comment.ts",
            """class UserService {
  /*
   * Login method.
   */
  login(): void {}

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "login",
            kind="method",
        )

        output = file.source()

        assert "Login method." not in output
        assert "login(): void" not in output
        assert "run(): void" in output

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
            file.remove_member(
                "MissingService",
                "login",
                kind="method",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_missing_member_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing-member.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.remove_member(
                "UserService",
                "missing",
                kind="method",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_utf16_member_removal(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16.ts",
            """class EmojiService {
  message = "😀";

  describe(): string {
    return "测试🚀";
  }

  finish(): string {
    return "结束";
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "EmojiService",
            "describe",
            kind="method",
        )

        output = file.source()

        assert 'message = "😀";' in output
        assert 'return "测试🚀";' not in output
        assert 'return "结束";' in output

    def test_logging_and_dirty_tracking(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging.ts",
            """class UserService {
  login(): void {}

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "login",
            kind="method",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert operation["action"] == (
            "remove_member"
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
        assert operation["references"] == 0
        assert operation["forced"] is False

        assert (
            operation["engine"]
            == "typescript_ast"
        )

    def test_remove_first_member_whitespace(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "first.ts",
            """class UserService {
  first(): void {}

  second(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "first",
            kind="method",
        )

        assert file.source() == """class UserService {
  second(): void {}
}
"""

    def test_remove_middle_member_whitespace(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "middle.ts",
            """class UserService {
  first(): void {}

  second(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "second",
            kind="method",
        )

        assert file.source() == """class UserService {
  first(): void {}

  third(): void {}
}
"""

    def test_remove_last_member_whitespace(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "last.ts",
            """class UserService {
  first(): void {}

  second(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "second",
            kind="method",
        )

        assert file.source() == """class UserService {
  first(): void {}
}
"""

    def test_remove_only_member(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "only.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_member(
            "UserService",
            "login",
            kind="method",
        )

        assert file.source() == (
            "class UserService {}\n"
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

        assert file.remove_member(
            "UserService",
            "second",
            kind="method",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
