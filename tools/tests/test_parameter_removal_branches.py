from __future__ import annotations

import pytest

from tools.modifier.parameter_removal import (
    ParameterRemoval,
    ParameterRemovalContext,
    ParameterRemovalPlanner,
    ParameterRemovalShape,
    ParameterRemovalStrategy,
    RemoveFirstParameterStrategy,
    RemoveLastParameterStrategy,
    RemoveMiddleParameterStrategy,
    RemoveOnlyParameterStrategy,
    constructor_parentheses,
)


def make_context(
    *,
    source: str = (
        "constructor(alpha: string, "
        "beta: number, gamma: boolean) {}"
    ),
    constructor_start: int = 0,
    body_start: int | None = None,
    parameter_starts: tuple[int, ...]
    | None = None,
    parameter_ends: tuple[int, ...]
    | None = None,
    target_index: int = 0,
) -> ParameterRemovalContext:
    if body_start is None:
        body_start = source.index("{")

    if parameter_starts is None:
        parameter_starts = (
            source.index("alpha"),
            source.index("beta"),
            source.index("gamma"),
        )

    if parameter_ends is None:
        parameter_ends = (
            parameter_starts[0]
            + len("alpha: string"),
            parameter_starts[1]
            + len("beta: number"),
            parameter_starts[2]
            + len("gamma: boolean"),
        )

    return ParameterRemovalContext(
        source=source,
        constructor_start=constructor_start,
        body_start=body_start,
        parameter_starts=parameter_starts,
        parameter_ends=parameter_ends,
        target_index=target_index,
    )


class TestContextValidation:
    def test_source_must_be_string(self) -> None:
        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            ParameterRemovalContext(
                source=123,
                constructor_start=0,
                body_start=0,
                parameter_starts=(0,),
                parameter_ends=(0,),
                target_index=0,
            )

    @pytest.mark.parametrize(
        "field",
        (
            "constructor_start",
            "body_start",
            "target_index",
        ),
    )
    def test_indexes_must_be_integers(
        self,
        field: str,
    ) -> None:
        kwargs = {
            field: "1",
        }

        with pytest.raises(
            TypeError,
            match=f"{field} must be an integer",
        ):
            make_context(**kwargs)

    def test_negative_constructor_start(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="constructor_start",
        ):
            make_context(
                constructor_start=-1,
            )

    def test_negative_body_start(self) -> None:
        with pytest.raises(
            ValueError,
            match="body_start",
        ):
            make_context(
                body_start=-1,
            )

    def test_constructor_after_body(self) -> None:
        with pytest.raises(
            ValueError,
            match="after body_start",
        ):
            make_context(
                constructor_start=20,
                body_start=10,
            )

    def test_body_exceeds_source(self) -> None:
        with pytest.raises(
            ValueError,
            match="exceeds source length",
        ):
            make_context(
                body_start=999,
            )

    def test_parameter_starts_must_be_tuple(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="parameter_starts",
        ):
            make_context(
                parameter_starts=[1],
                parameter_ends=(2,),
            )

    def test_parameter_ends_must_be_tuple(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="parameter_ends",
        ):
            make_context(
                parameter_starts=(1,),
                parameter_ends=[2],
            )

    def test_parameter_counts_must_match(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="counts must match",
        ):
            make_context(
                parameter_starts=(1, 2),
                parameter_ends=(3,),
            )

    def test_at_least_one_parameter_required(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="at least one parameter",
        ):
            make_context(
                parameter_starts=(),
                parameter_ends=(),
            )

    @pytest.mark.parametrize(
        "target_index",
        (-1, 3),
    )
    def test_target_index_outside_range(
        self,
        target_index: int,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="outside parameter range",
        ):
            make_context(
                target_index=target_index,
            )

    def test_parameter_start_must_be_integer(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="starts must be integers",
        ):
            make_context(
                parameter_starts=("1",),
                parameter_ends=(2,),
            )

    def test_parameter_end_must_be_integer(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="ends must be integers",
        ):
            make_context(
                parameter_starts=(1,),
                parameter_ends=("2",),
            )

    @pytest.mark.parametrize(
        (
            "starts",
            "ends",
        ),
        (
            ((-1,), (1,)),
            ((1,), (-1,)),
        ),
    )
    def test_parameter_positions_not_negative(
        self,
        starts,
        ends,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="must not be negative",
        ):
            make_context(
                parameter_starts=starts,
                parameter_ends=ends,
            )

    def test_parameter_end_before_start(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="before start",
        ):
            make_context(
                parameter_starts=(5,),
                parameter_ends=(4,),
            )

    def test_parameter_exceeds_header(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="exceeds constructor header",
        ):
            make_context(
                parameter_starts=(1,),
                parameter_ends=(999,),
            )

    def test_parameter_ranges_overlap(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="non-overlapping",
        ):
            make_context(
                parameter_starts=(1, 4),
                parameter_ends=(5, 7),
            )

    def test_context_properties(self) -> None:
        context = make_context(
            target_index=1,
        )

        assert context.parameter_count == 3
        assert (
            context.target_start
            == context.parameter_starts[1]
        )
        assert (
            context.target_end
            == context.parameter_ends[1]
        )


class TestRemovalValidation:
    def test_start_must_be_integer(self) -> None:
        with pytest.raises(
            TypeError,
            match="start must be an integer",
        ):
            ParameterRemoval(
                start="1",
                end=2,
                shape=(
                    ParameterRemovalShape
                    .FIRST_PARAMETER
                ),
            )

    def test_end_must_be_integer(self) -> None:
        with pytest.raises(
            TypeError,
            match="end must be an integer",
        ):
            ParameterRemoval(
                start=1,
                end="2",
                shape=(
                    ParameterRemovalShape
                    .FIRST_PARAMETER
                ),
            )

    def test_start_not_negative(self) -> None:
        with pytest.raises(
            ValueError,
            match="start must not be negative",
        ):
            ParameterRemoval(
                start=-1,
                end=1,
                shape=(
                    ParameterRemovalShape
                    .FIRST_PARAMETER
                ),
            )

    def test_end_not_before_start(self) -> None:
        with pytest.raises(
            ValueError,
            match="before start",
        ):
            ParameterRemoval(
                start=2,
                end=1,
                shape=(
                    ParameterRemovalShape
                    .FIRST_PARAMETER
                ),
            )

    def test_range_not_empty(self) -> None:
        with pytest.raises(
            ValueError,
            match="must not be empty",
        ):
            ParameterRemoval(
                start=1,
                end=1,
                shape=(
                    ParameterRemovalShape
                    .FIRST_PARAMETER
                ),
            )


class TestParentheses:
    def test_parentheses_found(self) -> None:
        context = make_context()

        opening, closing = (
            constructor_parentheses(context)
        )

        assert opening == context.source.index("(")
        assert closing == context.source.index(")")

    @pytest.mark.parametrize(
        "source",
        (
            "constructor alpha {}",
            "constructor(alpha {}",
            "constructor)alpha( {}",
        ),
    )
    def test_invalid_parentheses_rejected(
        self,
        source: str,
    ) -> None:
        context = ParameterRemovalContext(
            source=source,
            constructor_start=0,
            body_start=source.index("{"),
            parameter_starts=(0,),
            parameter_ends=(1,),
            target_index=0,
        )

        with pytest.raises(
            ValueError,
            match="Unable to locate",
        ):
            constructor_parentheses(context)


class TestOnlyParameterStrategy:
    def test_supports_only_parameter(self) -> None:
        source = "constructor(alpha: string) {}"
        start = source.index("alpha")
        end = start + len("alpha: string")

        context = make_context(
            source=source,
            parameter_starts=(start,),
            parameter_ends=(end,),
        )

        strategy = RemoveOnlyParameterStrategy()

        assert strategy.supports(context)

        plan = strategy.plan(context)

        assert (
            plan.shape
            == ParameterRemovalShape.ONLY_PARAMETER
        )
        assert plan.start == source.index("(") + 1
        assert plan.end == source.index(")")

    def test_unsupported_context_rejected(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="does not support",
        ):
            RemoveOnlyParameterStrategy().plan(
                make_context()
            )


class TestFirstParameterStrategy:
    def test_first_parameter(self) -> None:
        context = make_context(
            target_index=0,
        )

        strategy = RemoveFirstParameterStrategy()

        assert strategy.supports(context)

        plan = strategy.plan(context)

        assert (
            plan.shape
            == ParameterRemovalShape.FIRST_PARAMETER
        )
        assert plan.start == context.target_start
        assert (
            plan.end
            == context.parameter_starts[1]
        )

    def test_unsupported_context_rejected(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="does not support",
        ):
            RemoveFirstParameterStrategy().plan(
                make_context(
                    target_index=1,
                )
            )


class TestLastParameterStrategy:
    def test_last_parameter(self) -> None:
        context = make_context(
            target_index=2,
        )

        strategy = RemoveLastParameterStrategy()

        assert strategy.supports(context)

        plan = strategy.plan(context)

        assert (
            plan.shape
            == ParameterRemovalShape.LAST_PARAMETER
        )
        assert (
            plan.start
            == context.parameter_ends[1]
        )
        assert plan.end == context.target_end

    def test_unsupported_context_rejected(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="does not support",
        ):
            RemoveLastParameterStrategy().plan(
                make_context(
                    target_index=0,
                )
            )


class TestMiddleParameterStrategy:
    def test_middle_parameter(self) -> None:
        context = make_context(
            target_index=1,
        )

        strategy = RemoveMiddleParameterStrategy()

        assert strategy.supports(context)

        plan = strategy.plan(context)

        assert (
            plan.shape
            == ParameterRemovalShape.MIDDLE_PARAMETER
        )
        assert plan.start == context.target_start
        assert (
            plan.end
            == context.parameter_starts[2]
        )

    def test_unsupported_context_rejected(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="does not support",
        ):
            RemoveMiddleParameterStrategy().plan(
                make_context(
                    target_index=0,
                )
            )


class NeverStrategy(ParameterRemovalStrategy):
    def supports(
        self,
        context: ParameterRemovalContext,
    ) -> bool:
        return False

    def plan(
        self,
        context: ParameterRemovalContext,
    ) -> ParameterRemoval:
        raise AssertionError(
            "plan must not be called"
        )


class TestPlanner:
    def test_default_strategies(self) -> None:
        planner = ParameterRemovalPlanner()

        assert len(planner.strategies) == 4

    def test_wrong_strategy_type_rejected(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="ParameterRemovalStrategy",
        ):
            ParameterRemovalPlanner(
                strategies=["invalid"]
            )

    def test_empty_strategy_collection_rejected(
        self,
    ) -> None:
        class TruthyEmpty(list):
            def __bool__(self) -> bool:
                return True

        with pytest.raises(
            ValueError,
            match="at least one removal strategy",
        ):
            ParameterRemovalPlanner(
                strategies=TruthyEmpty()
            )

    def test_wrong_context_type_rejected(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="ParameterRemovalContext",
        ):
            ParameterRemovalPlanner().plan(
                "invalid"
            )

    @pytest.mark.parametrize(
        (
            "target_index",
            "shape",
        ),
        (
            (
                0,
                ParameterRemovalShape
                .FIRST_PARAMETER,
            ),
            (
                1,
                ParameterRemovalShape
                .MIDDLE_PARAMETER,
            ),
            (
                2,
                ParameterRemovalShape
                .LAST_PARAMETER,
            ),
        ),
    )
    def test_selects_correct_strategy(
        self,
        target_index: int,
        shape: ParameterRemovalShape,
    ) -> None:
        plan = ParameterRemovalPlanner().plan(
            make_context(
                target_index=target_index,
            )
        )

        assert plan.shape == shape

    def test_no_strategy_supports(self) -> None:
        planner = ParameterRemovalPlanner(
            strategies=[NeverStrategy()]
        )

        with pytest.raises(
            ValueError,
            match="No parameter removal strategy",
        ):
            planner.plan(
                make_context()
            )
