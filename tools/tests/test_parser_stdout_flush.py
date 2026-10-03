from __future__ import annotations

import json
from pathlib import Path
import subprocess


def test_parser_never_forces_process_exit_after_stdout_write():
    parser = Path("tools/modifier/parser.js").read_text(encoding="utf-8")

    assert "process.stdout.write" in parser
    assert "process.exit(" not in parser
    assert "process.exitCode" in parser


def test_parser_pipe_output_is_complete_json(tmp_path):
    source = tmp_path / "large.controller.ts"
    methods = "\n".join(
        f"  method{i}(value: string): string {{ return value; }}"
        for i in range(500)
    )
    source.write_text(
        "export class LargeController {\n"
        "  constructor() {}\n"
        f"{methods}\n"
        "}\n",
        encoding="utf-8",
    )

    completed = subprocess.run(
        ["node", "tools/modifier/parser.js", str(source)],
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )

    assert completed.returncode == 0, completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["ok"] is True
    assert payload["classes"][0]["name"] == "LargeController"
    assert len(completed.stdout) > 50_000
