from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest

from tools.modifier.bridge import (
    TypeScriptBridge,
    TypeScriptBridgeError,
)


def test_invalid_json_reports_decode_boundary_without_hiding_stdout_tail(tmp_path):
    target = tmp_path / "target.ts"
    target.write_text("export class Example {}\n", encoding="utf-8")

    parser = tmp_path / "malformed_parser.py"
    parser.write_text(
        "import sys\n"
        "sys.stdout.write('{\"ok\": true}\\nTRAILING-PARSER-OUTPUT')\n"
        "sys.stderr.write('diagnostic-stderr')\n",
        encoding="utf-8",
    )

    workspace_rename = tmp_path / "workspace_rename.js"
    workspace_rename.write_text("// unused\n", encoding="utf-8")

    bridge = TypeScriptBridge(
        project_root=tmp_path,
        node_command=sys.executable,
        parser_path=parser,
        workspace_rename_path=workspace_rename,
    )

    with pytest.raises(TypeScriptBridgeError) as caught:
        bridge.parse(target)

    message = str(caught.value)
    assert "TypeScript parser returned invalid JSON" in message
    assert "json_error=Extra data" in message
    assert "returncode=0" in message
    assert "stdout_length=" in message
    assert "stdout_tail=" in message
    assert "TRAILING-PARSER-OUTPUT" in message
    assert "stderr_tail='diagnostic-stderr'" in message
