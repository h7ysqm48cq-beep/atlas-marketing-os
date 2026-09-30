from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ClassMemberNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class MemberMoveError(ValueError):
    """Base class member movement error."""


class InvalidMemberMove(
    MemberMoveError
):
    """Raised when a member movement is invalid."""


class UnsupportedMemberMove(
    MemberMoveError
):
    """Raised for unsupported member movement."""


class MemberMoveDirection(str, Enum):
    BEFORE = "before"
    AFTER = "after"
    TOP = "top"
    BOTTOM = "bottom"


@dataclass(frozen=True, slots=True)
class MemberMoveEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class MemberMovePlan:
    edits: tuple[MemberMoveEdit, ...]
    direction: MemberMoveDirection
    source_kind: str
    target_name: str | None
    comment_attached: bool


@dataclass(frozen=True, slots=True)
class MemberMoveContext:
    source: str
    member: ClassMemberNode
    members: tuple[
        ClassMemberNode,
        ...
    ]
    before: str | None = None
    after: str | None = None
    position: str | None = None


class MemberMovePlanner:
    def plan(
        self,
        context: MemberMoveContext,
    ) -> MemberMovePlan | None:
        if not isinstance(
            context,
            MemberMoveContext,
        ):
            raise TypeError(
                "context must be a "
                "MemberMoveContext"
            )

        self._validate_context(context)

        members = tuple(
            sorted(
                context.members,
                key=lambda item:
                    item.member_start,
            )
        )

        member = context.member

        try:
            source_index = members.index(
                member
            )
        except ValueError as error:
            raise InvalidMemberMove(
                "Source member is not present "
                "in the member collection"
            ) from error

        direction: MemberMoveDirection
        target_name: str | None
        target_index: int | None = None

        if context.before is not None:
            direction = (
                MemberMoveDirection.BEFORE
            )
            target_name = context.before

            target = self._find_target(
                members,
                target_name,
            )

            if target == member:
                return None

            target_index = members.index(
                target
            )

            if source_index + 1 == target_index:
                return None

        elif context.after is not None:
            direction = (
                MemberMoveDirection.AFTER
            )
            target_name = context.after

            target = self._find_target(
                members,
                target_name,
            )

            if target == member:
                return None

            target_index = members.index(
                target
            )

            if source_index - 1 == target_index:
                return None

        elif context.position == "top":
            direction = (
                MemberMoveDirection.TOP
            )
            target_name = None

            if source_index == 0:
                return None

        else:
            direction = (
                MemberMoveDirection.BOTTOM
            )
            target_name = None

            if source_index == (
                len(members) - 1
            ):
                return None

        block_infos = [
            self._move_block(
                context.source,
                item,
            )
            for item in members
        ]

        source_block = block_infos[
            source_index
        ]

        comment_attached = source_block[3]

        ordered_indexes = list(
            range(len(members))
        )

        ordered_indexes.pop(source_index)

        if direction == (
            MemberMoveDirection.TOP
        ):
            destination_index = 0

        elif direction == (
            MemberMoveDirection.BOTTOM
        ):
            destination_index = len(
                ordered_indexes
            )

        elif direction == (
            MemberMoveDirection.BEFORE
        ):
            assert target_index is not None

            destination_index = (
                ordered_indexes.index(
                    target_index
                )
            )

        else:
            assert target_index is not None

            destination_index = (
                ordered_indexes.index(
                    target_index
                )
                + 1
            )

        ordered_indexes.insert(
            destination_index,
            source_index,
        )

        region_start = min(
            item[0]
            for item in block_infos
        )

        region_end = max(
            item[1]
            for item in block_infos
        )

        blocks = [
            block_infos[index][2]
            .strip("\r\n")
            for index in ordered_indexes
        ]

        replacement = "\n\n".join(
            blocks
        )

        region_python_start = (
            utf16_offset_to_python_index(
                context.source,
                region_start,
            )
        )

        region_python_end = (
            utf16_offset_to_python_index(
                context.source,
                region_end,
            )
        )

        original_region = context.source[
            region_python_start:
            region_python_end
        ]

        if original_region.endswith(
            ("\n", "\r")
        ):
            replacement += "\n"

        return MemberMovePlan(
            edits=(
                MemberMoveEdit(
                    start=region_start,
                    end=region_end,
                    text=replacement,
                ),
            ),
            direction=direction,
            source_kind=member.kind,
            target_name=target_name,
            comment_attached=(
                comment_attached
            ),
        )

    @staticmethod
    def _validate_context(
        context: MemberMoveContext,
    ) -> None:
        options = (
            context.before is not None,
            context.after is not None,
            context.position is not None,
        )

        if sum(options) != 1:
            raise InvalidMemberMove(
                "Exactly one of before, after or "
                "position must be provided"
            )

        if context.before is not None:
            if (
                not isinstance(
                    context.before,
                    str,
                )
                or not context.before.strip()
            ):
                raise InvalidMemberMove(
                    "before must be a "
                    "non-empty string"
                )

        if context.after is not None:
            if (
                not isinstance(
                    context.after,
                    str,
                )
                or not context.after.strip()
            ):
                raise InvalidMemberMove(
                    "after must be a "
                    "non-empty string"
                )

        if context.position is not None:
            if context.position not in {
                "top",
                "bottom",
            }:
                raise InvalidMemberMove(
                    "position must be 'top' or "
                    "'bottom'"
                )

        if not context.members:
            raise InvalidMemberMove(
                "No class members are available"
            )

    @staticmethod
    def _find_target(
        members: tuple[
            ClassMemberNode,
            ...
        ],
        name: str,
    ) -> ClassMemberNode:
        matches = [
            member
            for member in members
            if member.name == name
        ]

        if not matches:
            raise InvalidMemberMove(
                f"Target member {name!r} "
                "was not found"
            )

        if len(matches) > 1:
            raise InvalidMemberMove(
                f"More than one target member "
                f"named {name!r} was found"
            )

        return matches[0]

    def _move_block(
        self,
        source: str,
        member: ClassMemberNode,
    ) -> tuple[int, int, str, bool]:
        start = member.removal_start
        end = member.removal_end

        python_start = (
            utf16_offset_to_python_index(
                source,
                start,
            )
        )

        python_end = (
            utf16_offset_to_python_index(
                source,
                end,
            )
        )

        expanded_python_start = (
            self._leading_comment_start(
                source,
                python_start,
            )
        )

        comment_attached = (
            expanded_python_start
            < python_start
        )

        expanded_start = utf16_length(
            source[:expanded_python_start]
        )

        block = source[
            expanded_python_start:
            python_end
        ]

        return (
            expanded_start,
            end,
            block,
            comment_attached,
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
                    MemberMovePlanner
                    ._block_comment_start(
                        source,
                        previous_line_start,
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
        line_start: int,
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
