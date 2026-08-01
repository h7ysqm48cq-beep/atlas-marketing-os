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


class TestMemberMove:
    def test_move_before(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "before.ts",
            """class UserService {
  first(): void {}

  second(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "third",
            before="first",
        )

        output = file.source()

        assert output.index(
            "third(): void"
        ) < output.index(
            "first(): void"
        ) < output.index(
            "second(): void"
        )

    def test_move_after(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "after.ts",
            """class UserService {
  first(): void {}

  second(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "first",
            after="third",
        )

        output = file.source()

        assert output.index(
            "second(): void"
        ) < output.index(
            "third(): void"
        ) < output.index(
            "first(): void"
        )

    def test_move_to_top(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "top.ts",
            """class UserService {
  first(): void {}

  second(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "third",
            position="top",
        )

        output = file.source()

        assert output.index(
            "third(): void"
        ) < output.index(
            "first(): void"
        ) < output.index(
            "second(): void"
        )

    def test_move_to_bottom(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "bottom.ts",
            """class UserService {
  first(): void {}

  second(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "first",
            position="bottom",
        )

        output = file.source()

        assert output.index(
            "second(): void"
        ) < output.index(
            "third(): void"
        ) < output.index(
            "first(): void"
        )

    def test_constructor_to_bottom(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "constructor.ts",
            """class UserService {
  constructor() {}

  first(): void {}

  second(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "constructor",
            kind="constructor",
            position="bottom",
        )

        output = file.source()

        assert output.index(
            "first(): void"
        ) < output.index(
            "second(): void"
        ) < output.index(
            "constructor()"
        )

    def test_comment_and_decorator_move_together(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "attached.ts",
            """class UserService {
  first(): void {}

  // Login method.
  @Log()
  public login(): boolean {
    return true;
  }

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "login",
            kind="method",
            position="top",
        )

        output = file.source()

        login_start = output.index(
            "// Login method."
        )

        first_start = output.index(
            "first(): void"
        )

        assert login_start < first_start

        assert (
            output.index("@Log()")
            < output.index(
                "public login(): boolean"
            )
        )

        assert (
            file.operations[-1][
                "comment_attached"
            ]
            is True
        )

    def test_block_comment_moves_together(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "block-comment.ts",
            """class UserService {
  first(): void {}

  /*
   * Login method.
   */
  login(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "login",
            position="top",
        )

        output = file.source()

        assert output.index(
            "/*"
        ) < output.index(
            "login(): void"
        ) < output.index(
            "first(): void"
        )

    @pytest.mark.parametrize(
        (
            "source",
            "member_name",
            "kwargs",
        ),
        [
            (
                """class UserService {
  first(): void {}

  second(): void {}
}
""",
                "first",
                {"position": "top"},
            ),
            (
                """class UserService {
  first(): void {}

  second(): void {}
}
""",
                "first",
                {"before": "second"},
            ),
            (
                """class UserService {
  first(): void {}

  second(): void {}
}
""",
                "second",
                {"after": "first"},
            ),
            (
                """class UserService {
  first(): void {}

  second(): void {}
}
""",
                "second",
                {"position": "bottom"},
            ),
        ],
    )
    def test_noop_moves_return_false(
        self,
        temp_workspace: Path,
        source: str,
        member_name: str,
        kwargs: dict[str, str],
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "noop.ts",
            source,
        )

        file = TypeScriptFile.load(path)

        assert (
            file.move_member(
                "UserService",
                member_name,
                **kwargs,
            )
            is False
        )

        assert file.source() == source
        assert file.operations == []
        assert file.dirty is False

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
            file.move_member(
                "MissingService",
                "login",
                position="top",
            )
            is False
        )

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
            file.move_member(
                "UserService",
                "missing",
                position="top",
            )
            is False
        )

    def test_missing_target_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing-target.ts",
            """class UserService {
  login(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="was not found",
        ):
            file.move_member(
                "UserService",
                "login",
                before="missing",
            )

    @pytest.mark.parametrize(
        "kwargs",
        [
            {},
            {
                "before": "first",
                "after": "second",
            },
            {
                "before": "first",
                "position": "top",
            },
            {
                "after": "second",
                "position": "bottom",
            },
        ],
    )
    def test_invalid_destination_options_rejected(
        self,
        temp_workspace: Path,
        kwargs: dict[str, str],
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-options.ts",
            """class UserService {
  first(): void {}

  second(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Exactly one",
        ):
            file.move_member(
                "UserService",
                "first",
                **kwargs,
            )

    def test_invalid_position_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-position.ts",
            """class UserService {
  first(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="position must be",
        ):
            file.move_member(
                "UserService",
                "first",
                position="middle",
            )

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

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="more than one member",
        ):
            file.move_member(
                "UserService",
                "active",
                before="run",
            )

    def test_move_getter_only(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "getter.ts",
            """class UserService {
  first(): void {}

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

        assert file.move_member(
            "UserService",
            "active",
            kind="getter",
            position="top",
        )

        output = file.source()

        assert output.index(
            "get active(): boolean"
        ) < output.index(
            "first(): void"
        ) < output.index(
            "set active(value: boolean)"
        )

    def test_move_setter_only(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "setter.ts",
            """class UserService {
  get active(): boolean {
    return true;
  }

  set active(value: boolean) {
    void value;
  }

  run(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "active",
            kind="setter",
            position="bottom",
        )

        output = file.source()

        assert output.index(
            "get active(): boolean"
        ) < output.index(
            "run(): void"
        ) < output.index(
            "set active(value: boolean)"
        )

    def test_utf16_member_move(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16.ts",
            """class EmojiService {
  message = "😀";

  first(): string {
    return "测试";
  }

  second(): string {
    return "结束";
  }
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "EmojiService",
            "second",
            position="top",
        )

        output = file.source()

        assert 'message = "😀";' in output
        assert 'return "测试";' in output
        assert 'return "结束";' in output

        assert output.index(
            "second(): string"
        ) < output.index(
            'message = "😀";'
        ) < output.index(
            "first(): string"
        )

    def test_logging_and_dirty_tracking(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging.ts",
            """class UserService {
  first(): void {}

  second(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "second",
            position="top",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "move_member"
        )

        assert (
            operation["class_name"]
            == "UserService"
        )

        assert (
            operation["member_name"]
            == "second"
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

  second(): void {}

  third(): void {}
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_member(
            "UserService",
            "third",
            position="top",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
