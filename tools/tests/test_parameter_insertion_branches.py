from __future__ import annotations

import pytest

from tools.modifier.constructor_parameter import (
    ConstructorParameter,
)
from tools.modifier.parameter_insertion import (
    ConstructorShape,
    EmptyConstructorInsertionStrategy,
    MultilineParameterInsertionStrategy,
    ParameterInsertion,
    ParameterInsertionContext,
    ParameterInsertionPlanner,
    ParameterInsertionStrategy,
    SingleLineParameterInsertionStrategy,
    constructor_parentheses,
)


def make_parameter() -> ConstructorParameter:
    return ConstructorParameter(
        name="service",
        type="AtlasService",
    )


def make_context(
    *,
    source: str = (
        "class UserService {\n"
        "  constructor(\n"
        "    private readonly config: ConfigService,\n"
        "    private readonly logger: Logger,\n"
        "  ) {}\n"
        "}\n"
    ),
    constructor_start: int | None = None,
    body_start: int | None = None,
    constructor_indent: str = "  ",
    parameter: ConstructorParameter | None = None,
    last_parameter_start: int | None = None,
    last_parameter_end: int | None = None,
) -> ParameterInsertionContext:
    if constructor_start is None:
        constructor_start = source.index(
            "constructor"
        )

    if body_start is None:
        body_start = source.index(
            "{",
            constructor_start,
        )

    if parameter is None:
        parameter = make_parameter()

    if (
        last_parameter_start is None
        and "logger" in source
    ):
        last_parameter_start = source.index(
            "private readonly logger"
        )

    if (
        last_parameter_end is None
        and "logger: Logger" in source
    ):
        last_parameter_end = (
            source.index("logger: Logger")
            + len("logger: Logger")
        )

    return ParameterInsertionContext(
        source=source,
        constructor_start=constructor_start,
        body_start=body_start,
        constructor_indent=constructor_indent,
        parameter=parameter,
        last_parameter_start=last_parameter_start,
        last_parameter_end=last_parameter_end,
    )


class TestContextValidation:
    def test_source_must_be_string(self) -> None:
        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            ParameterInsertionContext(
                source=123,
                constructor_start=0,
                body_start=0,
                constructor_indent="",
                parameter=make_parameter(),
            )

    def test_parameter_type_rejected(self) -> None:
        with pytest.raises(
            TypeError,
            match="ConstructorParameter",
        ):
            ParameterInsertionContext(
                source="constructor() {}",
                constructor_start=0,
                body_start=14,
                constructor_indent="",
                parameter="invalid",
            )

    @pytest.mark.parametrize(
        "field",
        (
            "constructor_start",
            "body_start",
        ),
    )
    def test_positions_must_be_integers(
        self,
        field: str,
    ) -> None:
        kwargs = {
            "source": "constructor() {}",
            "constructor_start": 0,
            "body_start": 14,
            "constructor_indent": "",
            "parameter": make_parameter(),
            field: "1",
        }

        with pytest.raises(
            TypeError,
            match=f"{field} must be an integer",
        ):
            ParameterInsertionContext(**kwargs)

    @pytest.mark.parametrize(
        "field",
        (
            "constructor_start",
            "body_start",
        ),
    )
    def test_positions_not_negative(
        self,
        field: str,
    ) -> None:
        kwargs = {
            "source": "constructor() {}",
            "constructor_start": 0,
            "body_start": 14,
            "constructor_indent": "",
            "parameter": make_parameter(),
            field: -1,
        }

        with pytest.raises(
            ValueError,
            match="must not be negative",
        ):
            ParameterInsertionContext(**kwargs)

    def test_body_exceeds_source(self) -> None:
        with pytest.raises(
            ValueError,
            match="exceeds source length",
        ):
            ParameterInsertionContext(
                source="constructor() {}",
                constructor_start=0,
                body_start=999,
                constructor_indent="",
                parameter=make_parameter(),
            )

    def test_constructor_after_body(self) -> None:
        with pytest.raises(
            ValueError,
            match="after body_start",
        ):
            ParameterInsertionContext(
                source="constructor() {}",
                constructor_start=10,
                body_start=5,
                constructor_indent="",
                parameter=make_parameter(),
            )


class TestInsertionValidation:
    def test_index_must_be_integer(self) -> None:
        with pytest.raises(
            TypeError,
            match="index must be an integer",
        ):
            ParameterInsertion(
                index="1",
                text="x",
                shape=ConstructorShape.EMPTY,
            )

    def test_index_not_negative(self) -> None:
        with pytest.raises(
            ValueError,
            match="must not be negative",
        ):
            ParameterInsertion(
                index=-1,
                text="x",
                shape=ConstructorShape.EMPTY,
            )

    def test_text_must_be_string(self) -> None:
        with pytest.raises(
            TypeError,
            match="text must be a string",
        ):
            ParameterInsertion(
                index=0,
                text=123,
                shape=ConstructorShape.EMPTY,
            )

    def test_text_not_empty(self) -> None:
        with pytest.raises(
            ValueError,
            match="must not be empty",
        ):
            ParameterInsertion(
                index=0,
                text="",
                shape=ConstructorShape.EMPTY,
            )

    def test_replace_end_must_be_integer(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="replace_end must be an integer",
        ):
            ParameterInsertion(
                index=0,
                replace_end="1",
                text="x",
                shape=ConstructorShape.EMPTY,
            )

    def test_replace_end_not_before_index(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="must not be before",
        ):
            ParameterInsertion(
                index=2,
                replace_end=1,
                text="x",
                shape=ConstructorShape.EMPTY,
            )


class TestParentheses:
    def test_parentheses_found(self) -> None:
        source = "constructor(alpha: string) {}"

        context = make_context(
            source=source,
            constructor_start=0,
            body_start=source.index("{"),
            last_parameter_start=source.index(
                "alpha"
            ),
            last_parameter_end=(
                source.index("alpha")
                + len("alpha: string")
            ),
        )

        opening, closing = constructor_parentheses(
            context
        )

        assert opening == source.index("(")
        assert closing == source.index(")")

    @pytest.mark.parametrize(
        "source",
        (
            "constructor alpha {}",
            "constructor(alpha {}",
            "constructor)alpha( {}",
        ),
    )
    def test_invalid_parentheses(
        self,
        source: str,
    ) -> None:
        context = ParameterInsertionContext(
            source=source,
            constructor_start=0,
            body_start=source.index("{"),
            constructor_indent="",
            parameter=make_parameter(),
        )

        with pytest.raises(
            ValueError,
            match="Unable to locate",
        ):
            constructor_parentheses(context)


class TestEmptyStrategy:
    def test_supports_false_with_last_parameter(
        self,
    ) -> None:
        context = make_context()

        assert not (
            EmptyConstructorInsertionStrategy()
            .supports(context)
        )

    def test_empty_constructor_supported(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  constructor() {}\n"
            "}\n"
        )

        context = make_context(
            source=source,
            last_parameter_start=None,
            last_parameter_end=None,
        )

        strategy = EmptyConstructorInsertionStrategy()

        assert strategy.supports(context)

        plan = strategy.plan(context)

        assert plan.shape == ConstructorShape.EMPTY
        assert (
            "private readonly service: AtlasService,"
            in plan.text
        )

    def test_plan_unsupported_rejected(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="does not support",
        ):
            EmptyConstructorInsertionStrategy().plan(
                make_context()
            )


class TestMultilineStrategy:
    def test_missing_start_not_supported(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  constructor(\n"
            "    private readonly config: ConfigService,\n"
            "  ) {}\n"
            "}\n"
        )

        context = ParameterInsertionContext(
            source=source,
            constructor_start=source.index(
                "constructor"
            ),
            body_start=source.index(
                "{",
                source.index("constructor"),
            ),
            constructor_indent="  ",
            parameter=make_parameter(),
            last_parameter_start=None,
            last_parameter_end=10,
        )

        assert not (
            MultilineParameterInsertionStrategy()
            .supports(context)
        )

    def test_missing_end_not_supported(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  constructor(\n"
            "    private readonly config: ConfigService,\n"
            "  ) {}\n"
            "}\n"
        )

        context = ParameterInsertionContext(
            source=source,
            constructor_start=source.index(
                "constructor"
            ),
            body_start=source.index(
                "{",
                source.index("constructor"),
            ),
            constructor_indent="  ",
            parameter=make_parameter(),
            last_parameter_start=10,
            last_parameter_end=None,
        )

        assert not (
            MultilineParameterInsertionStrategy()
            .supports(context)
        )

    def test_plan_unsupported_rejected(
        self,
    ) -> None:
        source = (
            "constructor(alpha: string) {}"
        )

        start = source.index("alpha")
        end = start + len("alpha: string")

        context = make_context(
            source=source,
            constructor_start=0,
            body_start=source.index("{"),
            constructor_indent="",
            last_parameter_start=start,
            last_parameter_end=end,
        )

        with pytest.raises(
            ValueError,
            match="does not support",
        ):
            MultilineParameterInsertionStrategy().plan(
                context
            )

    def test_multiline_with_existing_comma(
        self,
    ) -> None:
        context = make_context()

        plan = (
            MultilineParameterInsertionStrategy()
            .plan(context)
        )

        assert plan.shape == (
            ConstructorShape
            .MULTILINE_WITH_PARAMETERS
        )
        assert plan.text.startswith("\n")
        assert plan.text.endswith(",")

    def test_multiline_without_existing_comma(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  constructor(\n"
            "    private readonly config: ConfigService\n"
            "  ) {}\n"
            "}\n"
        )

        start = source.index(
            "private readonly config"
        )
        end = (
            source.index("config: ConfigService")
            + len("config: ConfigService")
        )

        context = make_context(
            source=source,
            last_parameter_start=start,
            last_parameter_end=end,
        )

        plan = (
            MultilineParameterInsertionStrategy()
            .plan(context)
        )

        assert plan.text.startswith(",\n")
        assert not plan.text.endswith(",")

    def test_tail_skips_whitespace_before_comma(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  constructor(\n"
            "    private readonly config: ConfigService \t ,\n"
            "  ) {}\n"
            "}\n"
        )

        start = source.index(
            "private readonly config"
        )
        end = (
            source.index("config: ConfigService")
            + len("config: ConfigService")
        )

        context = make_context(
            source=source,
            last_parameter_start=start,
            last_parameter_end=end,
        )

        plan = (
            MultilineParameterInsertionStrategy()
            .plan(context)
        )

        assert plan.text.startswith("\n")


class TestSingleLineStrategy:
    def test_missing_start_not_supported(
        self,
    ) -> None:
        context = make_context(
            last_parameter_start=None,
            last_parameter_end=10,
        )

        assert not (
            SingleLineParameterInsertionStrategy()
            .supports(context)
        )

    def test_missing_end_not_supported(
        self,
    ) -> None:
        context = make_context(
            last_parameter_start=10,
            last_parameter_end=None,
        )

        assert not (
            SingleLineParameterInsertionStrategy()
            .supports(context)
        )

    def test_plan_unsupported_rejected(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="does not support",
        ):
            SingleLineParameterInsertionStrategy().plan(
                make_context()
            )

    def test_empty_existing_content_rejected(
        self,
    ) -> None:
        source = "constructor() {}"

        context = ParameterInsertionContext(
            source=source,
            constructor_start=0,
            body_start=source.index("{"),
            constructor_indent="",
            parameter=make_parameter(),
            last_parameter_start=0,
            last_parameter_end=1,
        )

        with pytest.raises(
            ValueError,
            match="requires at least one",
        ):
            SingleLineParameterInsertionStrategy().plan(
                context
            )

    def test_singleline_converted_to_multiline(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  constructor(private readonly config: ConfigService) {}\n"
            "}\n"
        )

        start = source.index(
            "private readonly config"
        )
        end = (
            source.index("config: ConfigService")
            + len("config: ConfigService")
        )

        context = make_context(
            source=source,
            last_parameter_start=start,
            last_parameter_end=end,
        )

        plan = (
            SingleLineParameterInsertionStrategy()
            .plan(context)
        )

        assert plan.shape == (
            ConstructorShape
            .SINGLE_LINE_WITH_PARAMETERS
        )
        assert plan.replace_end == source.index(")")
        assert (
            "private readonly service: AtlasService,"
            in plan.text
        )

    def test_existing_trailing_comma_normalized(
        self,
    ) -> None:
        source = (
            "constructor(alpha: string,) {}"
        )

        start = source.index("alpha")
        end = start + len("alpha: string")

        context = make_context(
            source=source,
            constructor_start=0,
            body_start=source.index("{"),
            constructor_indent="",
            last_parameter_start=start,
            last_parameter_end=end,
        )

        plan = (
            SingleLineParameterInsertionStrategy()
            .plan(context)
        )

        assert "alpha: string,," not in plan.text


class NeverStrategy(ParameterInsertionStrategy):
    def supports(
        self,
        context: ParameterInsertionContext,
    ) -> bool:
        return False

    def plan(
        self,
        context: ParameterInsertionContext,
    ) -> ParameterInsertion:
        raise AssertionError(
            "plan must not be called"
        )


class TestPlanner:
    def test_default_strategies(self) -> None:
        planner = ParameterInsertionPlanner()

        assert len(planner.strategies) == 3

    def test_empty_constructor_selected(
        self,
    ) -> None:
        source = "constructor() {}"

        context = make_context(
            source=source,
            constructor_start=0,
            body_start=source.index("{"),
            constructor_indent="",
            last_parameter_start=None,
            last_parameter_end=None,
        )

        plan = ParameterInsertionPlanner().plan(
            context
        )

        assert plan.shape == ConstructorShape.EMPTY

    def test_multiline_selected(self) -> None:
        plan = ParameterInsertionPlanner().plan(
            make_context()
        )

        assert plan.shape == (
            ConstructorShape
            .MULTILINE_WITH_PARAMETERS
        )

    def test_singleline_selected(self) -> None:
        source = "constructor(alpha: string) {}"

        start = source.index("alpha")
        end = start + len("alpha: string")

        context = make_context(
            source=source,
            constructor_start=0,
            body_start=source.index("{"),
            constructor_indent="",
            last_parameter_start=start,
            last_parameter_end=end,
        )

        plan = ParameterInsertionPlanner().plan(
            context
        )

        assert plan.shape == (
            ConstructorShape
            .SINGLE_LINE_WITH_PARAMETERS
        )

    def test_no_strategy_supports(self) -> None:
        planner = ParameterInsertionPlanner(
            strategies=[NeverStrategy()]
        )

        with pytest.raises(
            ValueError,
            match="No parameter insertion strategy",
        ):
            planner.plan(
                make_context()
            )


def test_singleline_missing_parameter_offset_not_supported() -> None:
    source = "constructor(alpha: string) {}"

    context = ParameterInsertionContext(
        source=source,
        constructor_start=0,
        body_start=source.index("{"),
        constructor_indent="",
        parameter=make_parameter(),
        last_parameter_start=None,
        last_parameter_end=(
            source.index("alpha")
            + len("alpha: string")
        ),
    )

    assert (
        SingleLineParameterInsertionStrategy()
        .supports(context)
        is False
    )


def test_multiline_tail_noncomma_character_branch() -> None:
    source = (
        "class UserService {\n"
        "  constructor(\n"
        "    private readonly config: ConfigService"
        " unexpected\n"
        "  ) {}\n"
        "}\n"
    )

    parameter_start = source.index(
        "private readonly config"
    )

    parameter_end = (
        source.index("config: ConfigService")
        + len("config: ConfigService")
    )

    context = ParameterInsertionContext(
        source=source,
        constructor_start=source.index(
            "constructor"
        ),
        body_start=source.index(
            "{",
            source.index("constructor"),
        ),
        constructor_indent="  ",
        parameter=make_parameter(),
        last_parameter_start=parameter_start,
        last_parameter_end=parameter_end,
    )

    plan = (
        MultilineParameterInsertionStrategy()
        .plan(context)
    )

    assert plan.shape == (
        ConstructorShape
        .MULTILINE_WITH_PARAMETERS
    )

    assert plan.index == parameter_end
    assert plan.text.startswith(",\n")


def test_multiline_tail_contains_only_whitespace(
    monkeypatch,
) -> None:
    source = (
        "constructor(\n"
        "  alpha: string   "
    )

    parameter_start = source.index(
        "alpha"
    )
    parameter_end = (
        parameter_start
        + len("alpha: string")
    )

    context = ParameterInsertionContext(
        source=source,
        constructor_start=0,
        body_start=len(source),
        constructor_indent="",
        parameter=make_parameter(),
        last_parameter_start=parameter_start,
        last_parameter_end=parameter_end,
    )

    strategy = (
        MultilineParameterInsertionStrategy()
    )

    # This fixture isolates the tail-scanning branch.
    monkeypatch.setattr(
        strategy,
        "supports",
        lambda current_context: True,
    )

    plan = strategy.plan(context)

    assert plan.index == parameter_end
    assert plan.text.startswith(",\n")
    assert plan.shape == (
        ConstructorShape
        .MULTILINE_WITH_PARAMETERS
    )
