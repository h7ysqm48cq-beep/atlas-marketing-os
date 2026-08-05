from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.modifier.bridge import (
    BridgeResult,
    TypeScriptBridge,
    TypeScriptBridgeError,
)


def make_parser(
    root: Path,
) -> Path:
    parser = (
        root
        / "tools"
        / "modifier"
        / "parser.js"
    )

    parser.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    parser.write_text(
        "// parser fixture\n",
        encoding="utf-8",
    )

    return parser


def make_bridge(
    root: Path,
) -> TypeScriptBridge:
    parser = make_parser(root)

    return TypeScriptBridge(
        project_root=root,
        parser_path=parser,
    )


def complete_payload(
    **overrides,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "ok": True,
        "file": {
            "path": "sample.ts",
        },
        "imports": [
            {
                "module": "./one",
            },
        ],
        "exports": [
            {
                "name": "Alpha",
            },
        ],
        "declarations": [
            {
                "name": "Alpha",
            },
        ],
        "exportedDeclarations": [
            {
                "name": "Alpha",
            },
        ],
        "renameSymbols": [
            {
                "name": "Alpha",
            },
        ],
        "memberRenameSymbols": [
            {
                "name": "run",
            },
        ],
        "classes": [
            {
                "name": "Alpha",
            },
        ],
        "diagnostics": [],
        "statistics": {
            "nodes": 1,
        },
    }

    payload.update(overrides)

    return payload


class TestBridgeResult:
    def test_ok_true(self) -> None:
        result = BridgeResult(
            file={},
            imports=[],
            exports=[],
            declarations=[],
            exported_declarations=[],
            rename_symbols=[],
            member_rename_symbols=[],
            classes=[],
            diagnostics=[],
            statistics={},
            raw={
                "ok": True,
            },
        )

        assert result.ok is True

    def test_ok_false_when_missing(self) -> None:
        result = BridgeResult(
            file={},
            imports=[],
            exports=[],
            declarations=[],
            exported_declarations=[],
            rename_symbols=[],
            member_rename_symbols=[],
            classes=[],
            diagnostics=[],
            statistics={},
            raw={},
        )

        assert result.ok is False

    def test_find_class_found(self) -> None:
        target = {
            "name": "Alpha",
        }

        result = BridgeResult(
            file={},
            imports=[],
            exports=[],
            declarations=[],
            exported_declarations=[],
            rename_symbols=[],
            member_rename_symbols=[],
            classes=(
                target,
                {
                    "name": "Beta",
                },
            ),
            diagnostics=[],
            statistics={},
            raw={},
        )

        assert result.find_class(
            "Alpha"
        ) is target

    def test_find_class_missing(self) -> None:
        result = BridgeResult(
            file={},
            imports=[],
            exports=[],
            declarations=[],
            exported_declarations=[],
            rename_symbols=[],
            member_rename_symbols=[],
            classes=[
                {
                    "name": "Alpha",
                },
            ],
            diagnostics=[],
            statistics={},
            raw={},
        )

        assert (
            result.find_class("Missing")
            is None
        )


class TestInitialization:
    def test_default_parser_path(
        self,
        tmp_path: Path,
    ) -> None:
        parser = make_parser(tmp_path)

        bridge = TypeScriptBridge(
            project_root=tmp_path,
        )

        assert bridge.project_root == (
            tmp_path.resolve()
        )

        assert bridge.parser_path == (
            parser.resolve()
        )

        assert bridge.node_command == "node"

    def test_custom_parser_and_node_command(
        self,
        tmp_path: Path,
    ) -> None:
        parser = tmp_path / "custom-parser.js"

        parser.write_text(
            "// custom parser\n",
            encoding="utf-8",
        )

        bridge = TypeScriptBridge(
            project_root=tmp_path,
            parser_path=parser,
            node_command="node-custom",
        )

        assert bridge.parser_path == (
            parser.resolve()
        )

        assert (
            bridge.node_command
            == "node-custom"
        )

    def test_missing_parser_rejected(
        self,
        tmp_path: Path,
    ) -> None:
        with pytest.raises(
            TypeScriptBridgeError,
            match="Parser does not exist",
        ):
            TypeScriptBridge(
                project_root=tmp_path,
                parser_path=(
                    tmp_path
                    / "missing-parser.js"
                ),
            )


class TestResolve:
    def test_relative_path_resolved(
        self,
        tmp_path: Path,
    ) -> None:
        bridge = make_bridge(tmp_path)

        result = bridge.resolve(
            "src/sample.ts"
        )

        assert result == (
            tmp_path
            / "src"
            / "sample.ts"
        ).resolve()

    def test_absolute_path_inside_root(
        self,
        tmp_path: Path,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = (
            tmp_path
            / "src"
            / "sample.ts"
        ).resolve()

        assert bridge.resolve(path) == path

    def test_path_escape_rejected(
        self,
        tmp_path: Path,
    ) -> None:
        bridge = make_bridge(tmp_path)

        outside = (
            tmp_path.parent
            / "outside.ts"
        )

        with pytest.raises(
            TypeScriptBridgeError,
            match="escapes project root",
        ):
            bridge.resolve(outside)


class TestParseSource:
    def test_source_must_be_string(
        self,
        tmp_path: Path,
    ) -> None:
        bridge = make_bridge(tmp_path)

        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            bridge.parse_source(123)

    @pytest.mark.parametrize(
        "suffix",
        (
            ".js",
            ".jsx",
            "",
        ),
    )
    def test_invalid_suffix_rejected(
        self,
        tmp_path: Path,
        suffix: str,
    ) -> None:
        bridge = make_bridge(tmp_path)

        with pytest.raises(
            TypeScriptBridgeError,
            match="Expected .ts or .tsx",
        ):
            bridge.parse_source(
                "const value = 1;",
                suffix=suffix,
            )

    @pytest.mark.parametrize(
        "suffix",
        (
            ".ts",
            ".tsx",
        ),
    )
    def test_temp_file_created_and_removed(
        self,
        tmp_path: Path,
        monkeypatch,
        suffix: str,
    ) -> None:
        bridge = make_bridge(tmp_path)

        captured: dict[str, object] = {}

        def fake_parse(
            file_path: str | Path,
        ) -> BridgeResult:
            path = Path(file_path)

            captured["path"] = path
            captured["exists"] = path.exists()
            captured["suffix"] = path.suffix
            captured["content"] = (
                path.read_text(
                    encoding="utf-8",
                )
            )

            return BridgeResult(
                file={},
                imports=[],
                exports=[],
                declarations=[],
                exported_declarations=[],
                rename_symbols=[],
                member_rename_symbols=[],
                classes=[],
                diagnostics=[],
                statistics={},
                raw={
                    "ok": True,
                },
            )

        monkeypatch.setattr(
            bridge,
            "parse",
            fake_parse,
        )

        result = bridge.parse_source(
            "const value = 1;",
            suffix=suffix,
        )

        temporary_path = captured["path"]

        assert isinstance(
            temporary_path,
            Path,
        )

        assert captured["exists"] is True
        assert captured["suffix"] == suffix
        assert (
            captured["content"]
            == "const value = 1;"
        )
        assert (
            temporary_path.exists()
            is False
        )
        assert result.ok is True

    def test_temp_file_removed_when_parse_fails(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        bridge = make_bridge(tmp_path)

        captured: dict[str, Path] = {}

        def fake_parse(
            file_path: str | Path,
        ) -> BridgeResult:
            path = Path(file_path)

            captured["path"] = path

            raise RuntimeError(
                "parse failed"
            )

        monkeypatch.setattr(
            bridge,
            "parse",
            fake_parse,
        )

        with pytest.raises(
            RuntimeError,
            match="parse failed",
        ):
            bridge.parse_source(
                "const value = 1;"
            )

        assert (
            captured["path"].exists()
            is False
        )

    def test_cleanup_skips_missing_temp_file(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        bridge = make_bridge(tmp_path)

        captured: dict[str, Path] = {}

        def fake_parse(
            file_path: str | Path,
        ) -> BridgeResult:
            path = Path(file_path)

            captured["path"] = path
            path.unlink()

            return BridgeResult(
                file={},
                imports=[],
                exports=[],
                declarations=[],
                exported_declarations=[],
                rename_symbols=[],
                member_rename_symbols=[],
                classes=[],
                diagnostics=[],
                statistics={},
                raw={
                    "ok": True,
                },
            )

        monkeypatch.setattr(
            bridge,
            "parse",
            fake_parse,
        )

        result = bridge.parse_source(
            "const value = 1;"
        )

        assert result.ok is True
        assert (
            captured["path"].exists()
            is False
        )


class TestParse:
    def test_missing_file_rejected(
        self,
        tmp_path: Path,
    ) -> None:
        bridge = make_bridge(tmp_path)

        with pytest.raises(
            TypeScriptBridgeError,
            match="does not exist",
        ):
            bridge.parse(
                "missing.ts"
            )

    def test_invalid_file_suffix_rejected(
        self,
        tmp_path: Path,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "sample.js"

        path.write_text(
            "const value = 1;",
            encoding="utf-8",
        )

        with pytest.raises(
            TypeScriptBridgeError,
            match="Expected .ts or .tsx",
        ):
            bridge.parse(path)

    def test_subprocess_arguments_and_payload(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        parser = make_parser(tmp_path)

        bridge = TypeScriptBridge(
            project_root=tmp_path,
            parser_path=parser,
            node_command="custom-node",
        )

        source_path = tmp_path / "sample.ts"

        source_path.write_text(
            "class Alpha {}",
            encoding="utf-8",
        )

        payload = complete_payload()

        captured: dict[str, object] = {}

        def fake_run(
            args,
            *,
            cwd,
            text,
            capture_output,
            check,
        ):
            captured["args"] = args
            captured["cwd"] = cwd
            captured["text"] = text
            captured[
                "capture_output"
            ] = capture_output
            captured["check"] = check

            return SimpleNamespace(
                stdout=json.dumps(
                    payload
                ),
                stderr="",
                returncode=0,
            )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            fake_run,
        )

        result = bridge.parse(
            source_path
        )

        assert captured["args"] == [
            "custom-node",
            str(parser.resolve()),
            str(source_path.resolve()),
        ]

        assert captured["cwd"] == (
            tmp_path.resolve()
        )
        assert captured["text"] is True
        assert (
            captured["capture_output"]
            is True
        )
        assert captured["check"] is False

        assert result.ok is True
        assert result.file == payload["file"]
        assert (
            result.imports
            == payload["imports"]
        )
        assert (
            result.exports
            == payload["exports"]
        )
        assert (
            result.declarations
            == payload["declarations"]
        )
        assert (
            result.exported_declarations
            == payload[
                "exportedDeclarations"
            ]
        )
        assert (
            result.rename_symbols
            == payload["renameSymbols"]
        )
        assert (
            result.member_rename_symbols
            == payload[
                "memberRenameSymbols"
            ]
        )
        assert (
            result.classes
            == payload["classes"]
        )
        assert (
            result.diagnostics
            == payload["diagnostics"]
        )
        assert (
            result.statistics
            == payload["statistics"]
        )
        assert result.raw == payload

    def test_tsx_file_supported(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "component.tsx"

        path.write_text(
            "export const App = () => <div />;",
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            lambda *args, **kwargs: (
                SimpleNamespace(
                    stdout=json.dumps(
                        complete_payload()
                    ),
                    stderr="",
                    returncode=0,
                )
            ),
        )

        assert bridge.parse(path).ok is True

    def test_empty_stdout_rejected(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "sample.ts"

        path.write_text(
            "class Alpha {}",
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            lambda *args, **kwargs: (
                SimpleNamespace(
                    stdout="   ",
                    stderr="parser error",
                    returncode=1,
                )
            ),
        )

        with pytest.raises(
            TypeScriptBridgeError,
            match="produced no output",
        ) as error:
            bridge.parse(path)

        assert "parser error" in str(
            error.value
        )

    def test_invalid_json_rejected(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "sample.ts"

        path.write_text(
            "class Alpha {}",
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            lambda *args, **kwargs: (
                SimpleNamespace(
                    stdout="not-json",
                    stderr="invalid output",
                    returncode=1,
                )
            ),
        )

        with pytest.raises(
            TypeScriptBridgeError,
            match="invalid JSON",
        ) as error:
            bridge.parse(path)

        message = str(error.value)

        assert "not-json" in message
        assert "invalid output" in message

    @pytest.mark.parametrize(
        "returncode",
        (
            1,
            3,
            127,
        ),
    )
    def test_failure_returncode_uses_payload_error(
        self,
        tmp_path: Path,
        monkeypatch,
        returncode: int,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "sample.ts"

        path.write_text(
            "class Alpha {}",
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            lambda *args, **kwargs: (
                SimpleNamespace(
                    stdout=json.dumps(
                        {
                            "error": (
                                "custom parser "
                                "failure"
                            ),
                        }
                    ),
                    stderr="",
                    returncode=returncode,
                )
            ),
        )

        with pytest.raises(
            TypeScriptBridgeError,
            match="custom parser failure",
        ):
            bridge.parse(path)

    def test_failure_returncode_uses_default_error(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "sample.ts"

        path.write_text(
            "class Alpha {}",
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            lambda *args, **kwargs: (
                SimpleNamespace(
                    stdout=json.dumps({}),
                    stderr="",
                    returncode=1,
                )
            ),
        )

        with pytest.raises(
            TypeScriptBridgeError,
            match="TypeScript parser failed",
        ):
            bridge.parse(path)

    @pytest.mark.parametrize(
        "returncode",
        (
            0,
            2,
        ),
    )
    def test_success_returncodes_supported(
        self,
        tmp_path: Path,
        monkeypatch,
        returncode: int,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "sample.ts"

        path.write_text(
            "class Alpha {}",
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            lambda *args, **kwargs: (
                SimpleNamespace(
                    stdout=json.dumps(
                        complete_payload()
                    ),
                    stderr="",
                    returncode=returncode,
                )
            ),
        )

        assert bridge.parse(path).ok is True

    def test_non_dictionary_payload_rejected(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "sample.ts"

        path.write_text(
            "class Alpha {}",
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            lambda *args, **kwargs: (
                SimpleNamespace(
                    stdout=json.dumps(
                        [
                            "unexpected",
                        ]
                    ),
                    stderr="",
                    returncode=0,
                )
            ),
        )

        with pytest.raises(
            TypeScriptBridgeError,
            match="Unexpected parser response",
        ):
            bridge.parse(path)

    def test_missing_optional_payload_fields(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        bridge = make_bridge(tmp_path)

        path = tmp_path / "sample.ts"

        path.write_text(
            "class Alpha {}",
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "tools.modifier.bridge.subprocess.run",
            lambda *args, **kwargs: (
                SimpleNamespace(
                    stdout=json.dumps(
                        {
                            "ok": True,
                        }
                    ),
                    stderr="",
                    returncode=0,
                )
            ),
        )

        result = bridge.parse(path)

        assert result.file == {}
        assert result.imports == []
        assert result.exports == []
        assert result.declarations == []
        assert (
            result.exported_declarations
            == []
        )
        assert result.rename_symbols == []
        assert (
            result.member_rename_symbols
            == []
        )
        assert result.classes == []
        assert result.diagnostics == []
        assert result.statistics == {}
