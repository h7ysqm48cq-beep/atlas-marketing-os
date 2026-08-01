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


class TestDeclarationAdd:
    def test_add_declaration_to_bottom(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "bottom.ts",
            """class Alpha {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_declaration(
            "Beta",
            "class Beta {}",
            kind="class",
        )

        assert changed is True

        assert file.source() == """class Alpha {}

class Gamma {}

class Beta {}
"""

    def test_add_declaration_to_top(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "top.ts",
            """import { client } from "./client";

class Alpha {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_declaration(
            "Beta",
            "class Beta {}",
            kind="class",
            position="top",
        )

        assert changed is True

        output = file.source()

        assert output.index(
            'import { client }'
        ) < output.index(
            "class Beta"
        ) < output.index(
            "class Alpha"
        )

    def test_add_declaration_before_target(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "before.ts",
            """class Alpha {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_declaration(
            "Beta",
            "class Beta {}",
            kind="class",
            before="Gamma",
        )

        assert changed is True

        assert file.source() == """class Alpha {}

class Beta {}

class Gamma {}
"""

    def test_add_declaration_after_target(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "after.ts",
            """class Alpha {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_declaration(
            "Beta",
            "class Beta {}",
            kind="class",
            after="Alpha",
        )

        assert changed is True

        assert file.source() == """class Alpha {}

class Beta {}

class Gamma {}
"""

    def test_duplicate_declaration_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "duplicate.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="already exists",
        ):
            file.add_declaration(
                "Alpha",
                "class Alpha {}",
                kind="class",
            )

        assert file.source() == (
            "class Alpha {}\n"
        )

        assert file.operations == []
        assert file.dirty is False

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
            file.add_declaration(
                "Beta",
                "class Beta {}",
                kind="class",
                before="Missing",
            )

    def test_add_declaration_to_empty_file(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "empty.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_declaration(
            "Alpha",
            "class Alpha {}",
            kind="class",
        )

        assert changed is True
        assert file.source() == (
            "class Alpha {}"
        )

    def test_add_declaration_after_imports(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "imports-only.ts",
            'import { client } from "./client";\n',
        )

        file = TypeScriptFile.load(path)

        changed = file.add_declaration(
            "Alpha",
            "class Alpha {}",
            kind="class",
        )

        assert changed is True

        assert file.source() == (
            'import { client } from "./client";\n\n'
            'class Alpha {}\n'
        )

    def test_declaration_add_logging(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_declaration(
            "Beta",
            "class Beta {}",
            kind="class",
            position="top",
        )

        assert changed is True
        assert file.dirty is True

        assert file.operations[-1] == {
            "action": "add_declaration",
            "declaration_name": "Beta",
            "kind": "class",
            "direction": "top",
            "target_name": None,
            "engine": "typescript_ast",
        }


class TestClassAdd:
    def test_add_empty_class(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "basic-class.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_class(
            "Beta",
        )

        assert changed is True

        assert file.source() == """class Alpha {}

class Beta {}
"""

    def test_add_class_with_body(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "class-body.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_class(
            "Beta",
            body="""run(): void {
  return;
}""",
        )

        assert changed is True

        assert """class Beta {
  run(): void {
    return;
  }
}""" in file.source()

    def test_add_decorated_exported_class(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "decorated-class.ts",
            """import { Injectable } from "./di";

class Alpha {}
""",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_class(
            "Beta",
            decorators=[
                "Injectable()",
                "@Service()",
            ],
            modifiers=[
                "export",
                "default",
            ],
            body="run(): void {}",
            position="top",
        )

        assert changed is True

        output = file.source()

        assert output.index(
            'import { Injectable }'
        ) < output.index(
            "@Injectable()"
        ) < output.index(
            "@Service()"
        ) < output.index(
            "export default class Beta"
        ) < output.index(
            "class Alpha"
        )

    def test_add_class_with_heritage(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "heritage.ts",
            """class Alpha {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_class(
            "Beta",
            extends="BaseService",
            implements=[
                "OnModuleInit",
                "Disposable",
            ],
            before="Gamma",
        )

        assert changed is True

        assert (
            "class Beta extends BaseService "
            "implements OnModuleInit, Disposable"
            in file.source()
        )

    def test_add_class_text(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "class-text.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_class_text(
            """@Entity()
export class Beta {
  id!: string;
}""",
        )

        assert changed is True

        output = file.source()

        assert "@Entity()" in output
        assert "export class Beta" in output
        assert "id!: string;" in output

    def test_duplicate_class_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "duplicate-class.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="already exists",
        ):
            file.add_class(
                "Alpha",
            )

    @pytest.mark.parametrize(
        "class_text",
        [
            "class Beta {",
            "function Beta() {}",
            (
                "class Beta {}\n\n"
                "class Delta {}"
            ),
        ],
    )
    def test_invalid_class_text_rejected(
        self,
        temp_workspace: Path,
        class_text: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-class.ts",
            "class Alpha {}\n",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
        ):
            file.add_class_text(
                class_text,
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    def test_add_class_with_utf16_content(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16-class.ts",
            """class Alpha {
  value = "😀";
}
""",
        )

        file = TypeScriptFile.load(path)

        changed = file.add_class(
            "Beta",
            body='message = "测试🚀";',
            position="top",
        )

        assert changed is True

        output = file.source()

        assert 'message = "测试🚀";' in output
        assert 'value = "😀";' in output

        assert output.index(
            "class Beta"
        ) < output.index(
            "class Alpha"
        )

    def test_class_add_whitespace_stability(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "class-whitespace.ts",
            """class Alpha {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_class(
            "Beta",
            before="Gamma",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
