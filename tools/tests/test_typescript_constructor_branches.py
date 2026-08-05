from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.modifier.constructor_parameter import (
    ConstructorParameter,
)
from tools.modifier.parameter_insertion import (
    ConstructorShape,
    ParameterInsertion,
)
from tools.modifier.typescript_constructor import (
    ConstructorModifier,
    ConstructorModifierError,
    ConstructorNotFound,
    UnsupportedConstructorShape,
)


class FakeBridge:
    def __init__(self, result=None) -> None:
        self.result = result
        self.calls: list[Path] = []

    def parse(self, path: str | Path):
        self.calls.append(Path(path))
        return self.result


def make_modifier_without_init(
    *,
    source: str = "class UserService {}",
    bridge_result=None,
) -> ConstructorModifier:
    modifier = object.__new__(
        ConstructorModifier
    )

    modifier.path = Path("unused.ts")
    modifier.class_name = "UserService"
    modifier.project_root = Path(".")
    modifier.bridge = FakeBridge(
        bridge_result
    )
    modifier._source = source
    modifier._original_source = source
    modifier._bridge_result = bridge_result
    modifier._insertion_planner = (
        SimpleNamespace()
    )
    modifier._removal_planner = (
        SimpleNamespace()
    )

    return modifier


class TestBridgeResultBranches:
    def test_bridge_result_missing_rejected(
        self,
    ) -> None:
        modifier = make_modifier_without_init(
            bridge_result=None,
        )

        with pytest.raises(
            ConstructorModifierError,
            match="has not been parsed",
        ):
            modifier.bridge_result()


class TestClassAndConstructorBranches:
    def test_class_node_none_rejected(
        self,
        monkeypatch,
    ) -> None:
        modifier = make_modifier_without_init(
            bridge_result=object(),
        )

        navigator = SimpleNamespace(
            class_=lambda name: None,
        )

        monkeypatch.setattr(
            modifier,
            "navigator",
            lambda: navigator,
        )

        with pytest.raises(
            ConstructorModifierError,
            match="could not be resolved",
        ):
            modifier.class_node()

    def test_constructor_none_rejected(
        self,
        monkeypatch,
    ) -> None:
        modifier = make_modifier_without_init(
            bridge_result=object(),
        )

        class_node = SimpleNamespace(
            name="UserService",
            constructor=lambda: None,
        )

        monkeypatch.setattr(
            modifier,
            "class_node",
            lambda: class_node,
        )

        with pytest.raises(
            ConstructorNotFound,
            match="does not contain",
        ):
            modifier.constructor_node()


class TestParseCurrentSourceBranches:
    def test_same_disk_source_parses_directly(
        self,
        tmp_path: Path,
    ) -> None:
        path = tmp_path / "sample.ts"
        source = "class UserService {}\n"

        path.write_text(
            source,
            encoding="utf-8",
        )

        result = object()
        bridge = FakeBridge(result)

        modifier = make_modifier_without_init(
            source=source,
            bridge_result=None,
        )

        modifier.path = path
        modifier.bridge = bridge

        modifier._parse_current_source()

        assert modifier._bridge_result is result
        assert bridge.calls == [path]
        assert (
            path.read_text(
                encoding="utf-8"
            )
            == source
        )

    def test_different_source_restored_after_parse(
        self,
        tmp_path: Path,
    ) -> None:
        path = tmp_path / "sample.ts"

        disk_source = (
            "class UserService {}\n"
        )

        memory_source = (
            "class UserService {\n"
            "  constructor() {}\n"
            "}\n"
        )

        path.write_text(
            disk_source,
            encoding="utf-8",
        )

        parsed_sources: list[str] = []

        class ReadingBridge:
            def parse(
                self,
                current_path: str | Path,
            ):
                parsed_sources.append(
                    Path(current_path).read_text(
                        encoding="utf-8"
                    )
                )
                return object()

        modifier = make_modifier_without_init(
            source=memory_source,
        )

        modifier.path = path
        modifier.bridge = ReadingBridge()

        modifier._parse_current_source()

        assert parsed_sources == [
            memory_source
        ]

        assert (
            path.read_text(
                encoding="utf-8"
            )
            == disk_source
        )


class TestCommitEditorBranch:
    def test_no_change_returns_false(
        self,
    ) -> None:
        modifier = make_modifier_without_init()

        editor = SimpleNamespace(
            apply=lambda: False,
        )

        assert (
            modifier._commit_editor(editor)
            is False
        )


class TestRemovalContextBranch:
    def test_parameter_not_found_rejected(
        self,
    ) -> None:
        modifier = make_modifier_without_init(
            source=(
                "constructor("
                "alpha: string"
                ") {}"
            ),
        )

        parameter = SimpleNamespace(
            name="alpha",
            start=12,
            end=25,
        )

        constructor = SimpleNamespace(
            parameters=lambda: (
                parameter,
            ),
            start=0,
            body_start=28,
        )

        with pytest.raises(
            ValueError,
            match="parameter not found",
        ):
            modifier._build_parameter_removal_context(
                constructor,
                "missing",
            )


class TestAddParameterBranches:
    def test_insertion_planner_error_wrapped(
        self,
        monkeypatch,
    ) -> None:
        modifier = make_modifier_without_init(
            source="constructor() {}",
            bridge_result=object(),
        )

        constructor = SimpleNamespace(
            has_parameter=lambda name: False,
        )

        monkeypatch.setattr(
            modifier,
            "constructor_node",
            lambda: constructor,
        )

        monkeypatch.setattr(
            modifier,
            "_build_parameter_insertion_context",
            lambda constructor, parameter: (
                object()
            ),
        )

        modifier._insertion_planner = (
            SimpleNamespace(
                plan=lambda context: (
                    (_ for _ in ()).throw(
                        ValueError(
                            "unsupported shape"
                        )
                    )
                )
            )
        )

        parameter = ConstructorParameter(
            name="service",
            type="AtlasService",
        )

        with pytest.raises(
            UnsupportedConstructorShape,
            match="unsupported shape",
        ):
            modifier.add_parameter(
                parameter
            )

    def test_apply_replace_insertion_branch(
        self,
        monkeypatch,
    ) -> None:
        source = "constructor(alpha: string) {}"

        modifier = make_modifier_without_init(
            source=source,
            bridge_result=None,
        )

        insertion = ParameterInsertion(
            index=source.index("alpha"),
            replace_end=(
                source.index("alpha")
                + len("alpha: string")
            ),
            text="beta: number",
            shape=(
                ConstructorShape
                .SINGLE_LINE_WITH_PARAMETERS
            ),
        )

        monkeypatch.setattr(
            modifier,
            "bridge_result",
            lambda: None,
        )

        monkeypatch.setattr(
            modifier,
            "_parse_current_source",
            lambda: None,
        )

        assert (
            modifier._apply_parameter_insertion(
                insertion
            )
            is True
        )

        assert (
            modifier.source()
            == "constructor(beta: number) {}"
        )


class TestRemoveParameterBranches:
    def test_missing_parameter_returns_false(
        self,
        monkeypatch,
    ) -> None:
        modifier = make_modifier_without_init(
            bridge_result=object(),
        )

        constructor = SimpleNamespace(
            has_parameter=lambda name: False,
        )

        monkeypatch.setattr(
            modifier,
            "constructor_node",
            lambda: constructor,
        )

        assert (
            modifier.remove_parameter(
                "missing"
            )
            is False
        )
