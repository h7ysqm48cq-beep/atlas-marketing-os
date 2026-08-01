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


class TestMemberRename:
    def test_rename_method(
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
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "login",
            "authenticate",
            kind="method",
        )

        output = file.source()

        assert "authenticate(): boolean" in output
        assert "login(): boolean" not in output

    def test_rename_property(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "property.ts",
            """class UserService {
  active = true;
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "active",
            "enabled",
            kind="property",
        )

        output = file.source()

        assert "enabled = true;" in output
        assert "active = true;" not in output

    def test_rename_getter(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "getter.ts",
            """class UserService {
  get active(): boolean {
    return true;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "active",
            "enabled",
            kind="getter",
        )

        assert (
            "get enabled(): boolean"
            in file.source()
        )

    def test_rename_setter(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "setter.ts",
            """class UserService {
  set active(value: boolean) {
    void value;
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "active",
            "enabled",
            kind="setter",
        )

        assert (
            "set enabled(value: boolean)"
            in file.source()
        )

    def test_internal_reference_renamed(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "internal.ts",
            """class UserService {
  login(): boolean {
    return true;
  }

  test(): boolean {
    return this.login();
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "login",
            "authenticate",
            kind="method",
        )

        output = file.source()

        assert (
            "authenticate(): boolean"
            in output
        )

        assert (
            "return this.authenticate();"
            in output
        )

    def test_external_reference_renamed(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "external.ts",
            """class UserService {
  login(): boolean {
    return true;
  }
}

const service = new UserService();
service.login();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "login",
            "authenticate",
            kind="method",
        )

        output = file.source()

        assert (
            "service.authenticate();"
            in output
        )

        assert "service.login();" not in output

    def test_same_name_member_in_other_class_isolated(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "class-isolation.ts",
            """class UserService {
  login(): boolean {
    return true;
  }
}

class AdminService {
  login(): boolean {
    return false;
  }
}

const user = new UserService();
const admin = new AdminService();

user.login();
admin.login();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "login",
            "authenticate",
            kind="method",
        )

        output = file.source()

        user_start = output.index(
            "class UserService"
        )

        admin_start = output.index(
            "class AdminService"
        )

        user_section = output[
            user_start:
            admin_start
        ]

        admin_section = output[
            admin_start:
        ]

        assert (
            "authenticate(): boolean"
            in user_section
        )

        assert (
            "login(): boolean"
            in admin_section
        )

        assert "user.authenticate();" in output
        assert "admin.login();" in output

    def test_getter_setter_ambiguity_rejected(
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
            match="more than one renameable member",
        ):
            file.rename_member(
                "UserService",
                "active",
                "enabled",
            )

    def test_conflicting_member_name_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "conflict.ts",
            """class UserService {
  login(): void {}

  authenticate(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="already contains a member",
        ):
            file.rename_member(
                "UserService",
                "login",
                "authenticate",
                kind="method",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    @pytest.mark.parametrize(
        "new_name",
        [
            "",
            "123login",
            "user-login",
            "user login",
            "class",
        ],
    )
    def test_invalid_member_name_rejected(
        self,
        temp_workspace: Path,
        new_name: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-name.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        expected_exception = (
            ValueError
            if new_name == ""
            else UnsupportedTypeScriptImport
        )

        with pytest.raises(
            expected_exception,
        ):
            file.rename_member(
                "UserService",
                "login",
                new_name,
                kind="method",
            )

    def test_constructor_rename_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "constructor.ts",
            """class UserService {
  constructor() {}
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Constructors cannot be renamed",
        ):
            file.rename_member(
                "UserService",
                "constructor",
                "create",
                kind="constructor",
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
            file.rename_member(
                "MissingService",
                "login",
                "authenticate",
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
            file.rename_member(
                "UserService",
                "missing",
                "authenticate",
                kind="method",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_noop_rename_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "noop.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.rename_member(
                "UserService",
                "login",
                "login",
                kind="method",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_utf16_member_rename(
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
}

const service = new EmojiService();
service.describe();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "EmojiService",
            "describe",
            "summarize",
            kind="method",
        )

        output = file.source()

        assert 'message = "😀";' in output
        assert 'return "测试🚀";' in output
        assert "summarize(): string" in output
        assert "service.summarize();" in output

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

const service = new UserService();
service.login();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "login",
            "authenticate",
            kind="method",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "rename_member"
        )

        assert (
            operation["class_name"]
            == "UserService"
        )

        assert (
            operation["old_name"]
            == "login"
        )

        assert (
            operation["new_name"]
            == "authenticate"
        )

        assert operation["kind"] == "method"

        assert (
            operation["occurrences"]
            == 2
        )

        assert (
            operation["engine"]
            == "typescript_language_service"
        )

    def test_whitespace_stability(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "whitespace.ts",
            """class UserService {
  login(): void {}

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_member(
            "UserService",
            "login",
            "authenticate",
            kind="method",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
