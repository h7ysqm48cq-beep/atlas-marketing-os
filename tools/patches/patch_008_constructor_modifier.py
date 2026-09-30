#!/usr/bin/env python3
"""
Patch 008: Constructor Modifier Foundation

Creates:
    tools/modifier/typescript_constructor.py

Updates:
    tools/modifier/__init__.py

Adds:
    ConstructorParameter
    ConstructorModifier

Features:
    - Check mode
    - Apply mode
    - Idempotent
    - Automatic backup
    - Import verification
    - Preserves existing modifier exports

Usage:
    python3 tools/patches/patch_008_constructor_modifier.py --check
    python3 tools/patches/patch_008_constructor_modifier.py --apply
"""

from __future__ import annotations

import argparse
import ast
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable


PATCH_ID = "008"
PATCH_NAME = "Constructor Modifier Foundation"

PROJECT_ROOT = Path(__file__).resolve().parents[2]

MODIFIER_DIRECTORY = PROJECT_ROOT / "tools" / "modifier"
CONSTRUCTOR_MODIFIER_FILE = (
    MODIFIER_DIRECTORY / "typescript_constructor.py"
)
MODIFIER_INIT_FILE = MODIFIER_DIRECTORY / "__init__.py"

BACKUP_DIRECTORY = (
    PROJECT_ROOT
    / ".atlas"
    / "backups"
    / f"patch_{PATCH_ID}"
)


CONSTRUCTOR_MODIFIER_SOURCE = '''\
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True, frozen=True)
class ConstructorParameter:
    """
    Represents a TypeScript constructor parameter.

    Example:

        ConstructorParameter(
            name="config",
            parameter_type="ConfigService",
            visibility="private",
            readonly=True,
        )

    Produces a parameter declaration conceptually equivalent to:

        private readonly config: ConfigService
    """

    name: str
    parameter_type: str
    visibility: str = "private"
    readonly: bool = True

    def __post_init__(self) -> None:
        name = self.name.strip()
        parameter_type = self.parameter_type.strip()
        visibility = self.visibility.strip()

        if not name:
            raise ValueError(
                "Constructor parameter name cannot be empty"
            )

        if not parameter_type:
            raise ValueError(
                "Constructor parameter type cannot be empty"
            )

        allowed_visibility = {
            "",
            "public",
            "protected",
            "private",
        }

        if visibility not in allowed_visibility:
            raise ValueError(
                "visibility must be one of: "
                "'', 'public', 'protected', 'private'"
            )

        object.__setattr__(
            self,
            "name",
            name,
        )

        object.__setattr__(
            self,
            "parameter_type",
            parameter_type,
        )

        object.__setattr__(
            self,
            "visibility",
            visibility,
        )

    def declaration(self) -> str:
        """
        Return the TypeScript declaration for this parameter.
        """

        parts: list[str] = []

        if self.visibility:
            parts.append(self.visibility)

        if self.readonly:
            parts.append("readonly")

        parts.append(
            f"{self.name}: {self.parameter_type}"
        )

        return " ".join(parts)


class ConstructorModifier:
    """
    First-generation TypeScript constructor modifier.

    Public API:

        ConstructorModifier.load(path)
        modifier.has_parameter(name, parameter_type)
        modifier.add_parameter(parameter)
        modifier.source()
        modifier.save()

    Patch 008 establishes the stable public API.

    The actual constructor insertion implementation is introduced
    in the next constructor modification patch.
    """

    def __init__(
        self,
        path: Path,
        text: str,
    ) -> None:
        self.path = path
        self._original_text = text
        self._text = text
        self.dirty = False

    @classmethod
    def load(
        cls,
        path: str | Path,
    ) -> "ConstructorModifier":
        """
        Load a TypeScript file from disk.
        """

        file_path = Path(path)

        if not file_path.exists():
            raise FileNotFoundError(
                f"TypeScript file not found: {file_path}"
            )

        if not file_path.is_file():
            raise ValueError(
                f"Expected a file path: {file_path}"
            )

        text = file_path.read_text(
            encoding="utf-8",
        )

        return cls(
            path=file_path,
            text=text,
        )

    def has_parameter(
        self,
        name: str,
        parameter_type: str | None = None,
    ) -> bool:
        """
        Check whether a constructor parameter already exists.

        Patch 008 uses a conservative textual check.

        A later implementation may use AST positions internally
        without changing this method's public API.
        """

        normalized_name = name.strip()

        if not normalized_name:
            raise ValueError(
                "Constructor parameter name cannot be empty"
            )

        if parameter_type is None:
            patterns = (
                f"{normalized_name}:",
                f"{normalized_name} :",
            )

            return any(
                pattern in self._text
                for pattern in patterns
            )

        normalized_type = parameter_type.strip()

        if not normalized_type:
            raise ValueError(
                "Constructor parameter type cannot be empty"
            )

        patterns = (
            f"{normalized_name}: {normalized_type}",
            f"{normalized_name}:{normalized_type}",
            f"{normalized_name} : {normalized_type}",
            f"{normalized_name} :{normalized_type}",
        )

        return any(
            pattern in self._text
            for pattern in patterns
        )

    def add_parameter(
        self,
        parameter: ConstructorParameter,
    ) -> bool:
        """
        Add a parameter to the target TypeScript constructor.

        The stable API is established in Patch 008.

        The actual source transformation is intentionally implemented
        in the next patch after constructor parsing and insertion rules
        are validated.
        """

        if not isinstance(
            parameter,
            ConstructorParameter,
        ):
            raise TypeError(
                "parameter must be a ConstructorParameter"
            )

        if self.has_parameter(
            parameter.name,
            parameter.parameter_type,
        ):
            return False

        raise NotImplementedError(
            "Constructor insertion is not implemented in Patch 008. "
            "Apply the next constructor modification patch."
        )

    def source(self) -> str:
        """
        Return the current in-memory source.
        """

        return self._text

    def original_source(self) -> str:
        """
        Return the source as it was when loaded or last saved.
        """

        return self._original_text

    def has_changes(self) -> bool:
        """
        Return True when the in-memory source has changed.
        """

        return self._text != self._original_text

    def reset(self) -> None:
        """
        Discard unsaved in-memory changes.
        """

        self._text = self._original_text
        self.dirty = False

    def save(self) -> bool:
        """
        Save the modified source to disk.

        Returns:
            True when the file was written.
            False when there were no changes.
        """

        if not self.has_changes():
            self.dirty = False
            return False

        self.path.write_text(
            self._text,
            encoding="utf-8",
        )

        self._original_text = self._text
        self.dirty = False

        return True
'''


EXPORT_IMPORT_BLOCK = '''\
from .typescript_constructor import (
    ConstructorModifier,
    ConstructorParameter,
)
'''

EXPORT_NAMES = (
    "ConstructorModifier",
    "ConstructorParameter",
)


@dataclass(slots=True)
class FileChange:
    path: Path
    operation: str
    changed: bool
    details: str


def relative(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def print_header() -> None:
    print()
    print("=" * 72)
    print(
        f"ATLAS PATCH {PATCH_ID}: "
        f"{PATCH_NAME}"
    )
    print("=" * 72)
    print()


def ensure_project_structure() -> None:
    required = [
        PROJECT_ROOT / "tools",
        MODIFIER_DIRECTORY,
    ]

    missing = [
        path
        for path in required
        if not path.exists()
    ]

    if missing:
        formatted = "\n".join(
            f"  - {relative(path)}"
            for path in missing
        )

        raise RuntimeError(
            "Required project directories are missing:\n"
            f"{formatted}"
        )


def syntax_check(
    source: str,
    filename: str,
) -> None:
    try:
        ast.parse(
            source,
            filename=filename,
        )
    except SyntaxError as error:
        raise RuntimeError(
            f"Generated Python is invalid for {filename}: "
            f"{error}"
        ) from error


def normalize_newlines(text: str) -> str:
    return text.replace(
        "\r\n",
        "\n",
    ).replace(
        "\r",
        "\n",
    )


def ensure_trailing_newline(text: str) -> str:
    return text.rstrip() + "\n"


def create_backup(path: Path) -> Path | None:
    if not path.exists():
        return None

    timestamp = datetime.now().strftime(
        "%Y%m%d_%H%M%S_%f"
    )

    backup_path = (
        BACKUP_DIRECTORY
        / timestamp
        / path.relative_to(PROJECT_ROOT)
    )

    backup_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    shutil.copy2(
        path,
        backup_path,
    )

    return backup_path


def build_constructor_modifier_change() -> FileChange:
    desired = ensure_trailing_newline(
        normalize_newlines(
            CONSTRUCTOR_MODIFIER_SOURCE
        )
    )

    syntax_check(
        desired,
        relative(CONSTRUCTOR_MODIFIER_FILE),
    )

    if not CONSTRUCTOR_MODIFIER_FILE.exists():
        return FileChange(
            path=CONSTRUCTOR_MODIFIER_FILE,
            operation="CREATE",
            changed=True,
            details=(
                "Create ConstructorParameter and "
                "ConstructorModifier foundation"
            ),
        )

    current = ensure_trailing_newline(
        normalize_newlines(
            CONSTRUCTOR_MODIFIER_FILE.read_text(
                encoding="utf-8",
            )
        )
    )

    if current == desired:
        return FileChange(
            path=CONSTRUCTOR_MODIFIER_FILE,
            operation="UNCHANGED",
            changed=False,
            details="Constructor modifier already matches Patch 008",
        )

    return FileChange(
        path=CONSTRUCTOR_MODIFIER_FILE,
        operation="UPDATE",
        changed=True,
        details=(
            "Replace constructor modifier with "
            "Patch 008 canonical implementation"
        ),
    )


def find_import_insertion_index(
    lines: list[str],
) -> int:
    """
    Find a safe position after the existing top-level import section.
    """

    index = 0

    if lines and lines[0].startswith("#!"):
        index = 1

    while (
        index < len(lines)
        and (
            lines[index].strip() == ""
            or lines[index].lstrip().startswith("#")
        )
    ):
        index += 1

    if (
        index < len(lines)
        and lines[index].startswith('"""')
    ):
        quote = '"""'

        if lines[index].count(quote) >= 2:
            index += 1
        else:
            index += 1

            while index < len(lines):
                if quote in lines[index]:
                    index += 1
                    break

                index += 1

        while (
            index < len(lines)
            and lines[index].strip() == ""
        ):
            index += 1

    if (
        index < len(lines)
        and lines[index].startswith(
            "from __future__ import"
        )
    ):
        index += 1

        while (
            index < len(lines)
            and lines[index].strip() == ""
        ):
            index += 1

    import_end = index
    inside_parenthesized_import = False

    while import_end < len(lines):
        stripped = lines[import_end].strip()

        if inside_parenthesized_import:
            if ")" in stripped:
                inside_parenthesized_import = False

            import_end += 1
            continue

        if not stripped:
            import_end += 1
            continue

        if (
            stripped.startswith("import ")
            or stripped.startswith("from ")
        ):
            if (
                "(" in stripped
                and ")" not in stripped
            ):
                inside_parenthesized_import = True

            import_end += 1
            continue

        break

    return import_end


def append_exports_to_all(
    source: str,
    names: Iterable[str],
) -> str:
    """
    Add names to an existing __all__ list or tuple.

    If no __all__ is present, create one at the end of the file.
    """

    tree = ast.parse(
        source,
        filename=relative(MODIFIER_INIT_FILE),
    )

    all_node: ast.Assign | None = None

    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue

        if any(
            isinstance(target, ast.Name)
            and target.id == "__all__"
            for target in node.targets
        ):
            all_node = node
            break

    missing_names = [
        name
        for name in names
        if (
            f'"{name}"' not in source
            and f"'{name}'" not in source
        )
    ]

    if not missing_names:
        return source

    if all_node is None:
        block_lines = [
            "",
            "__all__ = [",
        ]

        block_lines.extend(
            f'    "{name}",'
            for name in missing_names
        )

        block_lines.append("]")

        return (
            source.rstrip()
            + "\n"
            + "\n".join(block_lines)
            + "\n"
        )

    value = all_node.value

    if not isinstance(
        value,
        (ast.List, ast.Tuple),
    ):
        raise RuntimeError(
            "tools/modifier/__init__.py contains a dynamic "
            "__all__ definition that Patch 008 cannot safely edit"
        )

    lines = source.splitlines(
        keepends=True,
    )

    closing_line_index = (
        value.end_lineno - 1
        if value.end_lineno is not None
        else None
    )

    if closing_line_index is None:
        raise RuntimeError(
            "Could not locate the existing __all__ closing line"
        )

    closing_line = lines[closing_line_index]
    indentation = (
        closing_line[
            : len(closing_line)
            - len(closing_line.lstrip())
        ]
    )

    entry_indentation = indentation + "    "

    insertion = "".join(
        f'{entry_indentation}"{name}",\n'
        for name in missing_names
    )

    lines.insert(
        closing_line_index,
        insertion,
    )

    return "".join(lines)


def build_updated_init_source() -> str:
    if MODIFIER_INIT_FILE.exists():
        source = MODIFIER_INIT_FILE.read_text(
            encoding="utf-8",
        )
    else:
        source = ""

    source = normalize_newlines(source)
    source = ensure_trailing_newline(source) if source else ""

    import_already_present = (
        "from .typescript_constructor import" in source
        and "ConstructorModifier" in source
        and "ConstructorParameter" in source
    )

    if not import_already_present:
        lines = source.splitlines(
            keepends=True,
        )

        insertion_index = find_import_insertion_index(
            lines
        )

        import_text = (
            EXPORT_IMPORT_BLOCK.rstrip()
            + "\n"
        )

        if insertion_index > 0:
            previous = lines[insertion_index - 1]

            if previous.strip():
                import_text = "\n" + import_text

        if (
            insertion_index < len(lines)
            and lines[insertion_index].strip()
        ):
            import_text += "\n"

        lines.insert(
            insertion_index,
            import_text,
        )

        source = "".join(lines)

    source = append_exports_to_all(
        source,
        EXPORT_NAMES,
    )

    source = ensure_trailing_newline(source)

    syntax_check(
        source,
        relative(MODIFIER_INIT_FILE),
    )

    return source


def build_init_change() -> FileChange:
    desired = build_updated_init_source()

    current = ""

    if MODIFIER_INIT_FILE.exists():
        current = ensure_trailing_newline(
            normalize_newlines(
                MODIFIER_INIT_FILE.read_text(
                    encoding="utf-8",
                )
            )
        )

    if current == desired:
        return FileChange(
            path=MODIFIER_INIT_FILE,
            operation="UNCHANGED",
            changed=False,
            details="Modifier exports already include Patch 008",
        )

    operation = (
        "UPDATE"
        if MODIFIER_INIT_FILE.exists()
        else "CREATE"
    )

    return FileChange(
        path=MODIFIER_INIT_FILE,
        operation=operation,
        changed=True,
        details=(
            "Export ConstructorModifier and "
            "ConstructorParameter"
        ),
    )


def collect_changes() -> list[FileChange]:
    return [
        build_constructor_modifier_change(),
        build_init_change(),
    ]


def print_changes(
    changes: list[FileChange],
) -> None:
    for change in changes:
        symbol = (
            "✓"
            if not change.changed
            else "•"
        )

        print(
            f"{symbol} [{change.operation}] "
            f"{relative(change.path)}"
        )
        print(
            f"    {change.details}"
        )

    print()

    changed_count = sum(
        1
        for change in changes
        if change.changed
    )

    print(
        f"Files requiring changes: {changed_count}"
    )


def write_constructor_modifier() -> None:
    CONSTRUCTOR_MODIFIER_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    CONSTRUCTOR_MODIFIER_FILE.write_text(
        ensure_trailing_newline(
            normalize_newlines(
                CONSTRUCTOR_MODIFIER_SOURCE
            )
        ),
        encoding="utf-8",
    )


def write_modifier_init() -> None:
    MODIFIER_INIT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    updated = build_updated_init_source()

    MODIFIER_INIT_FILE.write_text(
        updated,
        encoding="utf-8",
    )


def apply_changes(
    changes: list[FileChange],
) -> None:
    changed_paths = [
        change.path
        for change in changes
        if change.changed
    ]

    if not changed_paths:
        print(
            "Patch already applied. "
            "No files were changed."
        )
        return

    print("Creating backups...")

    for path in changed_paths:
        backup = create_backup(path)

        if backup is not None:
            print(
                f"  ✓ {relative(path)}"
            )
            print(
                f"    -> {relative(backup)}"
            )

    print()
    print("Applying changes...")

    for change in changes:
        if not change.changed:
            continue

        if change.path == CONSTRUCTOR_MODIFIER_FILE:
            write_constructor_modifier()

        elif change.path == MODIFIER_INIT_FILE:
            write_modifier_init()

        else:
            raise RuntimeError(
                f"Unknown patch target: {change.path}"
            )

        print(
            f"  ✓ {change.operation}: "
            f"{relative(change.path)}"
        )


def verify_files() -> None:
    print()
    print("Verifying patch...")

    if not CONSTRUCTOR_MODIFIER_FILE.exists():
        raise RuntimeError(
            "Constructor modifier file was not created"
        )

    if not MODIFIER_INIT_FILE.exists():
        raise RuntimeError(
            "tools/modifier/__init__.py is missing"
        )

    constructor_source = (
        CONSTRUCTOR_MODIFIER_FILE.read_text(
            encoding="utf-8",
        )
    )

    init_source = MODIFIER_INIT_FILE.read_text(
        encoding="utf-8",
    )

    syntax_check(
        constructor_source,
        relative(CONSTRUCTOR_MODIFIER_FILE),
    )

    syntax_check(
        init_source,
        relative(MODIFIER_INIT_FILE),
    )

    required_constructor_symbols = [
        "class ConstructorParameter",
        "class ConstructorModifier",
        "def load(",
        "def has_parameter(",
        "def add_parameter(",
        "def source(",
        "def save(",
    ]

    missing_symbols = [
        symbol
        for symbol in required_constructor_symbols
        if symbol not in constructor_source
    ]

    if missing_symbols:
        raise RuntimeError(
            "Constructor modifier verification failed. "
            "Missing:\n"
            + "\n".join(
                f"  - {symbol}"
                for symbol in missing_symbols
            )
        )

    for name in EXPORT_NAMES:
        if name not in init_source:
            raise RuntimeError(
                f"{name} is not exported from "
                "tools/modifier/__init__.py"
            )

    print(
        "  ✓ Python syntax valid"
    )
    print(
        "  ✓ ConstructorParameter present"
    )
    print(
        "  ✓ ConstructorModifier present"
    )
    print(
        "  ✓ Modifier exports present"
    )


def verify_imports() -> None:
    """
    Verify using a clean Python subprocess-style import environment.

    Since this patch runs inside the repository, importing directly
    is sufficient after invalidating import caches.
    """

    import importlib

    project_root = str(PROJECT_ROOT.resolve())

    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    importlib.invalidate_caches()

    modules_to_remove = [
        name
        for name in sys.modules
        if (
            name == "tools.modifier"
            or name.startswith(
                "tools.modifier."
            )
        )
    ]

    for module_name in modules_to_remove:
        sys.modules.pop(
            module_name,
            None,
        )

    modifier_module = importlib.import_module(
        "tools.modifier"
    )

    constructor_modifier = getattr(
        modifier_module,
        "ConstructorModifier",
        None,
    )

    constructor_parameter = getattr(
        modifier_module,
        "ConstructorParameter",
        None,
    )

    if constructor_modifier is None:
        raise RuntimeError(
            "ConstructorModifier import verification failed"
        )

    if constructor_parameter is None:
        raise RuntimeError(
            "ConstructorParameter import verification failed"
        )

    sample = constructor_parameter(
        name="atlasBrain",
        parameter_type="AtlasBrainService",
    )

    expected = (
        "private readonly "
        "atlasBrain: AtlasBrainService"
    )

    actual = sample.declaration()

    if actual != expected:
        raise RuntimeError(
            "ConstructorParameter declaration verification failed:\n"
            f"Expected: {expected}\n"
            f"Actual:   {actual}"
        )

    print(
        "  ✓ Import verification passed"
    )
    print(
        "  ✓ ConstructorParameter declaration passed"
    )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            f"Atlas Patch {PATCH_ID}: "
            f"{PATCH_NAME}"
        )
    )

    mode = parser.add_mutually_exclusive_group(
        required=True
    )

    mode.add_argument(
        "--check",
        action="store_true",
        help=(
            "Preview required changes without "
            "modifying files"
        ),
    )

    mode.add_argument(
        "--apply",
        action="store_true",
        help=(
            "Apply the patch and run verification"
        ),
    )

    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()

    print_header()

    try:
        ensure_project_structure()

        changes = collect_changes()
        print_changes(changes)

        if arguments.check:
            if any(
                change.changed
                for change in changes
            ):
                print(
                    "CHECK RESULT: PATCH REQUIRED"
                )
            else:
                print(
                    "CHECK RESULT: ALREADY APPLIED"
                )

            return 0

        apply_changes(changes)
        verify_files()
        verify_imports()

        print()
        print("=" * 72)
        print(
            f"PATCH {PATCH_ID} COMPLETED SUCCESSFULLY"
        )
        print("=" * 72)
        print()

        return 0

    except Exception as error:
        print()
        print("=" * 72)
        print(
            f"PATCH {PATCH_ID} FAILED"
        )
        print("=" * 72)
        print(
            f"{type(error).__name__}: {error}"
        )
        print()

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
