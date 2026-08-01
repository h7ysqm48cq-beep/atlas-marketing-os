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


class TestDeclarationMove:
    def test_move_before(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "before.ts",
            """class Alpha {}

class Beta {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Gamma",
            before="Alpha",
        )

        assert file.source() == """class Gamma {}

class Alpha {}

class Beta {}
"""

    def test_move_after(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "after.ts",
            """class Alpha {}

class Beta {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Alpha",
            after="Gamma",
        )

        assert file.source() == """class Beta {}

class Gamma {}

class Alpha {}
"""

    def test_move_to_top(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "top.ts",
            """class Alpha {}

class Beta {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Gamma",
            position="top",
        )

        assert file.source() == """class Gamma {}

class Alpha {}

class Beta {}
"""

    def test_move_to_bottom(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "bottom.ts",
            """class Alpha {}

class Beta {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Alpha",
            position="bottom",
        )

        assert file.source() == """class Beta {}

class Gamma {}

class Alpha {}
"""

    def test_comments_decorators_and_export_move_together(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "attached.ts",
            """function run(): void {}

// User model
@sealed
export class User {}

interface Account {
  id: string;
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "User",
            position="top",
        )

        output = file.source()

        assert output.startswith(
            "// User model\n"
            "@sealed\n"
            "export class User {}\n\n"
        )

        assert output.index(
            "export class User"
        ) < output.index(
            "function run"
        ) < output.index(
            "interface Account"
        )

        operation = file.operations[-1]

        assert (
            operation["comment_attached"]
            is True
        )

    def test_block_comment_moves_with_declaration(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "block-comment.ts",
            """class Alpha {}

/*
 * Beta service.
 */
class Beta {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Beta",
            position="top",
        )

        output = file.source()

        assert output.startswith(
            "/*\n"
            " * Beta service.\n"
            " */\n"
            "class Beta {}\n\n"
        )

    def test_imports_remain_above_declarations(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "imports.ts",
            """import { client } from "./client";

class Alpha {}

class Beta {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Beta",
            position="top",
        )

        assert file.source() == """import { client } from "./client";

class Beta {}

class Alpha {}
"""

    @pytest.mark.parametrize(
        (
            "source",
            "name",
            "kwargs",
        ),
        [
            (
                """class Alpha {}

class Beta {}
""",
                "Alpha",
                {"position": "top"},
            ),
            (
                """class Alpha {}

class Beta {}
""",
                "Alpha",
                {"before": "Beta"},
            ),
            (
                """class Alpha {}

class Beta {}
""",
                "Beta",
                {"after": "Alpha"},
            ),
            (
                """class Alpha {}

class Beta {}
""",
                "Beta",
                {"position": "bottom"},
            ),
        ],
    )
    def test_noop_moves_return_false(
        self,
        temp_workspace: Path,
        source: str,
        name: str,
        kwargs: dict[str, str],
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "noop.ts",
            source,
        )

        file = TypeScriptFile.load(path)

        assert (
            file.move_declaration(
                name,
                **kwargs,
            )
            is False
        )

        assert file.source() == source
        assert file.operations == []
        assert file.dirty is False

    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.move_declaration(
                "Missing",
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
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="was not found",
        ):
            file.move_declaration(
                "Alpha",
                before="Missing",
            )

    @pytest.mark.parametrize(
        "kwargs",
        [
            {},
            {
                "before": "Alpha",
                "after": "Beta",
            },
            {
                "before": "Alpha",
                "position": "top",
            },
            {
                "after": "Beta",
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
            """class Alpha {}

class Beta {}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Exactly one",
        ):
            file.move_declaration(
                "Alpha",
                **kwargs,
            )

    def test_invalid_position_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-position.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="position must be",
        ):
            file.move_declaration(
                "Alpha",
                position="middle",
            )

    def test_multi_variable_statement_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "multi-variable.ts",
            """const alpha = 1, beta = 2;

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="multi-variable statement",
        ):
            file.move_declaration(
                "alpha",
                position="bottom",
            )

    def test_destructuring_declaration_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "destructuring.ts",
            """const { alpha } = source;

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="destructuring",
        ):
            file.move_declaration(
                "alpha",
                position="bottom",
            )

    def test_utf16_offsets(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16.ts",
            """const emoji = "😀";

class Alpha {}

class Beta {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Beta",
            before="Alpha",
        )

        assert file.source() == """const emoji = "😀";

class Beta {}

class Alpha {}
"""

    def test_move_logging_and_dirty_tracking(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging.ts",
            """class Alpha {}

class Beta {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Beta",
            position="top",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert operation["action"] == (
            "move_declaration"
        )

        assert operation["name"] == "Beta"
        assert operation["kind"] == "class"
        assert operation["direction"] == "top"
        assert operation["target"] is None
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
            """class Alpha {}

class Beta {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.move_declaration(
            "Gamma",
            before="Alpha",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
