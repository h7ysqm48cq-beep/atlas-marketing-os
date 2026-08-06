from __future__ import annotations

from typing import Any


class InvalidNodeError(
    TypeError,
):
    """
    Raised when an object cannot be treated
    as a valid AST node.
    """


def node_start(
    node: Any,
) -> int:

    value = getattr(
        node,
        "start",
        None,
    )

    if (
        isinstance(value, bool)
        or not isinstance(
            value,
            int,
        )
    ):
        raise InvalidNodeError(
            "AST node exposes invalid start offset"
        )

    return value


def node_end(
    node: Any,
) -> int:

    value = getattr(
        node,
        "end",
        None,
    )

    if (
        isinstance(value, bool)
        or not isinstance(
            value,
            int,
        )
    ):
        raise InvalidNodeError(
            "AST node exposes invalid end offset"
        )

    return value
    def node_range(
    node: Any,
) -> tuple[int, int]:

    start = node_start(
        node,
    )

    end = node_end(
        node,
    )

    if end < start:

        raise InvalidNodeError(
            "AST node has invalid range"
        )

    return (
        start,
        end,
    )
    def node_length(
    node: Any,
) -> int:

    start, end = node_range(node)

    return end - start


def contains(
    outer: Any,
    inner: Any,
) -> bool:

    outer_start, outer_end = node_range(outer)
    inner_start, inner_end = node_range(inner)

    return (
        outer_start <= inner_start
        and inner_end <= outer_end
    )


def overlaps(
    left: Any,
    right: Any,
) -> bool:

    left_start, left_end = node_range(left)
    right_start, right_end = node_range(right)

    return (
        left_start < right_end
        and right_start < left_end
    )


def is_adjacent(
    left: Any,
    right: Any,
) -> bool:

    _, left_end = node_range(left)
    right_start, _ = node_range(right)

    return left_end == right_start
    def sort_nodes(
    nodes: Iterable[Any],
) -> list[Any]:

    return sorted(
        nodes,
        key=node_start,
    )


def validate_node(
    node: Any,
) -> None:

    node_range(node)