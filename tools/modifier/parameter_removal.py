from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum


class ParameterRemovalShape(str, Enum):
    """Supported constructor parameter removal shapes."""

    ONLY_PARAMETER = "only_parameter"
    FIRST_PARAMETER = "first_parameter"
    MIDDLE_PARAMETER = "middle_parameter"
    LAST_PARAMETER = "last_parameter"


@dataclass(frozen=True)
class ParameterRemovalContext:
    """
    Source information required to plan removal of one
    constructor parameter.

    All positions use Python string indexes.

    parameter_starts and parameter_ends must describe
    constructor parameters in source order.
    """

    source: str
    constructor_start: int
    body_start: int
    parameter_starts: tuple[int, ...]
    parameter_ends: tuple[int, ...]
    target_index: int

    def __post_init__(self) -> None:
        if not isinstance(self.source, str):
            raise TypeError(
                "source must be a string"
            )

        for name in (
            "constructor_start",
            "body_start",
            "target_index",
        ):
            value = getattr(self, name)

            if not isinstance(value, int):
                raise TypeError(
                    f"{name} must be an integer"
                )

        if self.constructor_start < 0:
            raise ValueError(
                "constructor_start must not be negative"
            )

        if self.body_start < 0:
            raise ValueError(
                "body_start must not be negative"
            )

        if self.constructor_start > self.body_start:
            raise ValueError(
                "constructor_start must not be after "
                "body_start"
            )

        if self.body_start > len(self.source):
            raise ValueError(
                "body_start exceeds source length"
            )

        if not isinstance(
            self.parameter_starts,
            tuple,
        ):
            raise TypeError(
                "parameter_starts must be a tuple"
            )

        if not isinstance(
            self.parameter_ends,
            tuple,
        ):
            raise TypeError(
                "parameter_ends must be a tuple"
            )

        if (
            len(self.parameter_starts)
            != len(self.parameter_ends)
        ):
            raise ValueError(
                "parameter start and end counts "
                "must match"
            )

        if not self.parameter_starts:
            raise ValueError(
                "at least one parameter is required"
            )

        if not (
            0
            <= self.target_index
            < len(self.parameter_starts)
        ):
            raise ValueError(
                "target_index is outside parameter "
                "range"
            )

        previous_end: int | None = None

        for index, (start, end) in enumerate(
            zip(
                self.parameter_starts,
                self.parameter_ends,
                strict=True,
            )
        ):
            if not isinstance(start, int):
                raise TypeError(
                    "parameter starts must be integers"
                )

            if not isinstance(end, int):
                raise TypeError(
                    "parameter ends must be integers"
                )

            if start < 0 or end < 0:
                raise ValueError(
                    "parameter positions must not be "
                    "negative"
                )

            if end < start:
                raise ValueError(
                    f"parameter {index} end must not "
                    "be before start"
                )

            if end > self.body_start:
                raise ValueError(
                    f"parameter {index} exceeds "
                    "constructor header"
                )

            if (
                previous_end is not None
                and start < previous_end
            ):
                raise ValueError(
                    "parameter ranges must be ordered "
                    "and non-overlapping"
                )

            previous_end = end

    @property
    def parameter_count(self) -> int:
        return len(self.parameter_starts)

    @property
    def target_start(self) -> int:
        return self.parameter_starts[
            self.target_index
        ]

    @property
    def target_end(self) -> int:
        return self.parameter_ends[
            self.target_index
        ]


@dataclass(frozen=True)
class ParameterRemoval:
    """A planned source deletion range."""

    start: int
    end: int
    shape: ParameterRemovalShape

    def __post_init__(self) -> None:
        if not isinstance(self.start, int):
            raise TypeError(
                "start must be an integer"
            )

        if not isinstance(self.end, int):
            raise TypeError(
                "end must be an integer"
            )

        if self.start < 0:
            raise ValueError(
                "start must not be negative"
            )

        if self.end < self.start:
            raise ValueError(
                "end must not be before start"
            )

        if self.end == self.start:
            raise ValueError(
                "removal range must not be empty"
            )


class ParameterRemovalStrategy(ABC):
    """Base class for parameter removal strategies."""

    @abstractmethod
    def supports(
        self,
        context: ParameterRemovalContext,
    ) -> bool:
        """Return whether the strategy supports context."""

    @abstractmethod
    def plan(
        self,
        context: ParameterRemovalContext,
    ) -> ParameterRemoval:
        """Create a removal plan without editing source."""


def constructor_parentheses(
    context: ParameterRemovalContext,
) -> tuple[int, int]:
    """
    Return absolute indexes of the constructor opening
    and closing parentheses.
    """

    header = context.source[
        context.constructor_start:
        context.body_start
    ]

    opening_relative = header.find("(")
    closing_relative = header.rfind(")")

    if (
        opening_relative < 0
        or closing_relative < 0
        or closing_relative <= opening_relative
    ):
        raise ValueError(
            "Unable to locate constructor parentheses"
        )

    return (
        context.constructor_start
        + opening_relative,
        context.constructor_start
        + closing_relative,
    )


class RemoveOnlyParameterStrategy(
    ParameterRemovalStrategy
):
    """
    Remove the only constructor parameter and collapse
    the constructor parameter list to empty parentheses.
    """

    def supports(
        self,
        context: ParameterRemovalContext,
    ) -> bool:
        return context.parameter_count == 1

    def plan(
        self,
        context: ParameterRemovalContext,
    ) -> ParameterRemoval:
        if not self.supports(context):
            raise ValueError(
                "Only-parameter strategy does not "
                "support this context"
            )

        opening, closing = constructor_parentheses(
            context
        )

        return ParameterRemoval(
            start=opening + 1,
            end=closing,
            shape=(
                ParameterRemovalShape
                .ONLY_PARAMETER
            ),
        )


class RemoveFirstParameterStrategy(
    ParameterRemovalStrategy
):
    """Remove the first parameter and following separator."""

    def supports(
        self,
        context: ParameterRemovalContext,
    ) -> bool:
        return (
            context.parameter_count > 1
            and context.target_index == 0
        )

    def plan(
        self,
        context: ParameterRemovalContext,
    ) -> ParameterRemoval:
        if not self.supports(context):
            raise ValueError(
                "First-parameter strategy does not "
                "support this context"
            )

        return ParameterRemoval(
            start=context.target_start,
            end=context.parameter_starts[1],
            shape=(
                ParameterRemovalShape
                .FIRST_PARAMETER
            ),
        )


class RemoveLastParameterStrategy(
    ParameterRemovalStrategy
):
    """Remove the final parameter and preceding separator."""

    def supports(
        self,
        context: ParameterRemovalContext,
    ) -> bool:
        return (
            context.parameter_count > 1
            and context.target_index
            == context.parameter_count - 1
        )

    def plan(
        self,
        context: ParameterRemovalContext,
    ) -> ParameterRemoval:
        if not self.supports(context):
            raise ValueError(
                "Last-parameter strategy does not "
                "support this context"
            )

        previous_end = context.parameter_ends[
            context.target_index - 1
        ]

        return ParameterRemoval(
            start=previous_end,
            end=context.target_end,
            shape=(
                ParameterRemovalShape
                .LAST_PARAMETER
            ),
        )


class RemoveMiddleParameterStrategy(
    ParameterRemovalStrategy
):
    """Remove a parameter between two other parameters."""

    def supports(
        self,
        context: ParameterRemovalContext,
    ) -> bool:
        return (
            context.parameter_count > 2
            and 0
            < context.target_index
            < context.parameter_count - 1
        )

    def plan(
        self,
        context: ParameterRemovalContext,
    ) -> ParameterRemoval:
        if not self.supports(context):
            raise ValueError(
                "Middle-parameter strategy does not "
                "support this context"
            )

        return ParameterRemoval(
            start=context.target_start,
            end=context.parameter_starts[
                context.target_index + 1
            ],
            shape=(
                ParameterRemovalShape
                .MIDDLE_PARAMETER
            ),
        )


class ParameterRemovalPlanner:
    """Select a strategy and create a removal plan."""

    def __init__(
        self,
        strategies: (
            list[ParameterRemovalStrategy]
            | tuple[ParameterRemovalStrategy, ...]
            | None
        ) = None,
    ) -> None:
        self.strategies = tuple(
            strategies
            or (
                RemoveOnlyParameterStrategy(),
                RemoveFirstParameterStrategy(),
                RemoveMiddleParameterStrategy(),
                RemoveLastParameterStrategy(),
            )
        )

        if not self.strategies:
            raise ValueError(
                "at least one removal strategy is "
                "required"
            )

        for strategy in self.strategies:
            if not isinstance(
                strategy,
                ParameterRemovalStrategy,
            ):
                raise TypeError(
                    "strategies must contain "
                    "ParameterRemovalStrategy objects"
                )

    def plan(
        self,
        context: ParameterRemovalContext,
    ) -> ParameterRemoval:
        if not isinstance(
            context,
            ParameterRemovalContext,
        ):
            raise TypeError(
                "context must be a "
                "ParameterRemovalContext"
            )

        for strategy in self.strategies:
            if strategy.supports(context):
                return strategy.plan(context)

        raise ValueError(
            "No parameter removal strategy supports "
            "this context"
        )
