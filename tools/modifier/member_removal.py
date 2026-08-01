from __future__ import annotations

from dataclasses import dataclass

from .ast_navigator import (
    ClassMemberNode,
    ClassNode,
    MemberRenameSymbolNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class MemberRemovalError(ValueError):
    """Base member removal error."""


class MemberStillReferenced(
    MemberRemovalError
):
    """Raised when a member still has references."""


class UnsupportedMemberRemoval(
    MemberRemovalError
):
    """Raised for unsupported member removal."""


@dataclass(frozen=True, slots=True)
class MemberRemovalEdit:
    start: int
    end: int
    text: str = ""


@dataclass(frozen=True, slots=True)
class MemberRemovalPlan:
    edits: tuple[MemberRemovalEdit, ...]
    class_name: str
    member_name: str
    kind: str
    reference_count: int
    forced: bool


@dataclass(frozen=True, slots=True)
class MemberRemovalContext:
    source: str
    class_name: str
    class_node: ClassNode
    member: ClassMemberNode
    symbol: MemberRenameSymbolNode | None
    declaration_ranges: tuple[
        tuple[int, int],
        ...
    ]
    force: bool = False


class MemberRemovalPlanner:
    def plan(
        self,
        context: MemberRemovalContext,
    ) -> MemberRemovalPlan:
        if not isinstance(
            context,
            MemberRemovalContext,
        ):
            raise TypeError(
                "context must be a "
                "MemberRemovalContext"
            )

        if not isinstance(
            context.source,
            str,
        ):
            raise TypeError(
                "source must be a string"
            )

        if not isinstance(
            context.force,
            bool,
        ):
            raise TypeError(
                "force must be a boolean"
            )

        reference_count = (
            self._reference_count(
                context.symbol,
                context.declaration_ranges,
            )
        )

        if (
            reference_count > 0
            and not context.force
        ):
            raise MemberStillReferenced(
                f"Class member "
                f"{context.class_name!r}."
                f"{context.member.name!r} "
                f"still has {reference_count} "
                "semantic reference(s)"
            )

        members = (
            context.class_node.members()
        )

        if len(members) == 1:
            edit = self._empty_class_edit(
                context.source,
                context.class_node,
            )
        else:
            start, end = (
                self._member_removal_range(
                    context.source,
                    context.class_node,
                    context.member,
                )
            )

            edit = MemberRemovalEdit(
                start=start,
                end=end,
            )

        return MemberRemovalPlan(
            edits=(edit,),
            class_name=context.class_name,
            member_name=context.member.name,
            kind=context.member.kind,
            reference_count=reference_count,
            forced=context.force,
        )

    @staticmethod
    def _empty_class_edit(
        source: str,
        class_node: ClassNode,
    ) -> MemberRemovalEdit:
        class_start = (
            utf16_offset_to_python_index(
                source,
                class_node.class_start,
            )
        )

        class_end = (
            utf16_offset_to_python_index(
                source,
                class_node.class_end,
            )
        )

        opening_brace = source.find(
            "{",
            class_start,
            class_end,
        )

        closing_brace = source.rfind(
            "}",
            class_start,
            class_end,
        )

        if (
            opening_brace < 0
            or closing_brace < 0
            or closing_brace < opening_brace
        ):
            raise UnsupportedMemberRemoval(
                "Could not locate class body braces"
            )

        return MemberRemovalEdit(
            start=utf16_length(
                source[:opening_brace]
            ),
            end=utf16_length(
                source[:closing_brace + 1]
            ),
            text="{}",
        )

    @classmethod
    def _member_removal_range(
        cls,
        source: str,
        class_node: ClassNode,
        member: ClassMemberNode,
    ) -> tuple[int, int]:
        start = member.removal_start
        end = member.removal_end

        python_start = (
            utf16_offset_to_python_index(
                source,
                start,
            )
        )

        python_start = (
            cls._leading_comment_start(
                source,
                python_start,
            )
        )

        members = tuple(
            sorted(
                class_node.members(),
                key=lambda item:
                    item.member_start,
            )
        )

        try:
            member_index = members.index(
                member
            )
        except ValueError as error:
            raise UnsupportedMemberRemoval(
                "Member is not present in class"
            ) from error

        # The blank line before the final member is
        # part of that member's visual separator.
        if member_index == len(members) - 1:
            prefix = source[:python_start]

            if prefix.endswith("\r\n\r\n"):
                python_start -= 2
            elif prefix.endswith("\n\n"):
                python_start -= 1
            elif prefix.endswith("\r\r"):
                python_start -= 1

        return (
            utf16_length(
                source[:python_start]
            ),
            end,
        )

    @staticmethod
    def _leading_comment_start(
        source: str,
        member_start: int,
    ) -> int:
        current_start = member_start

        while current_start > 0:
            previous_line_end = current_start

            if (
                previous_line_end > 0
                and source[
                    previous_line_end - 1
                ] == "\n"
            ):
                previous_line_end -= 1

            if (
                previous_line_end > 0
                and source[
                    previous_line_end - 1
                ] == "\r"
            ):
                previous_line_end -= 1

            previous_line_start = (
                source.rfind(
                    "\n",
                    0,
                    previous_line_end,
                )
                + 1
            )

            previous_line = source[
                previous_line_start:
                previous_line_end
            ]

            stripped = previous_line.strip()

            if not stripped:
                break

            if stripped.startswith("//"):
                current_start = (
                    previous_line_start
                )
                continue

            if stripped.endswith("*/"):
                block_start = (
                    MemberRemovalPlanner
                    ._block_comment_start(
                        source,
                        previous_line_end,
                    )
                )

                if block_start is None:
                    break

                current_start = block_start
                continue

            break

        return current_start

    @staticmethod
    def _block_comment_start(
        source: str,
        line_end: int,
    ) -> int | None:
        opening = source.rfind(
            "/*",
            0,
            line_end,
        )

        if opening < 0:
            return None

        between = source[
            opening:
            line_end
        ]

        if "*/" not in between:
            return None

        opening_line_start = (
            source.rfind(
                "\n",
                0,
                opening,
            )
            + 1
        )

        prefix = source[
            opening_line_start:
            opening
        ]

        if prefix.strip():
            return None

        return opening_line_start

    @staticmethod
    def _reference_count(
        symbol: MemberRenameSymbolNode | None,
        declaration_ranges: tuple[
            tuple[int, int],
            ...
        ],
    ) -> int:
        if symbol is None:
            return 0

        return sum(
            1
            for occurrence in symbol.occurrences
            if not any(
                occurrence.start == start
                and occurrence.end == end
                for start, end
                in declaration_ranges
            )
        )
