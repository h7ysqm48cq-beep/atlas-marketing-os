from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ClassMemberNode,
    ClassNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class MemberAddError(ValueError):
    """Base class member addition error."""


class InvalidMemberAdd(MemberAddError):
    """Raised when a member addition is invalid."""


class MemberAddConflict(MemberAddError):
    """Raised when the new member conflicts."""


class MemberAddDirection(str, Enum):
    BEFORE = "before"
    AFTER = "after"
    TOP = "top"
    BOTTOM = "bottom"


@dataclass(frozen=True, slots=True)
class MemberAddEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class MemberAddPlan:
    edits: tuple[MemberAddEdit, ...]
    direction: MemberAddDirection
    member_name: str
    member_kind: str
    target_name: str | None


@dataclass(frozen=True, slots=True)
class MemberAddContext:
    source: str
    class_node: ClassNode
    member_name: str
    member_kind: str
    member_text: str
    before: str | None = None
    after: str | None = None
    position: str | None = None


class MemberAddPlanner:
    _KINDS = {
        "constructor",
        "method",
        "property",
        "getter",
        "setter",
    }

    def plan(
        self,
        context: MemberAddContext,
    ) -> MemberAddPlan:
        if not isinstance(
            context,
            MemberAddContext,
        ):
            raise TypeError(
                "context must be a MemberAddContext"
            )

        self._validate_context(context)

        members = tuple(
            sorted(
                context.class_node.members(),
                key=lambda item:
                    item.member_start,
            )
        )

        self._validate_conflict(
            members,
            context.member_name,
            context.member_kind,
        )

        direction, target_name, insert_index = (
            self._resolve_destination(
                members,
                before=context.before,
                after=context.after,
                position=context.position,
            )
        )

        member_block = self._indent_member(
            context.source,
            context.class_node,
            members,
            context.member_text,
        )

        if not members:
            edit = self._empty_class_edit(
                context.source,
                context.class_node,
                member_block,
            )

            return MemberAddPlan(
                edits=(edit,),
                direction=direction,
                member_name=context.member_name,
                member_kind=context.member_kind,
                target_name=target_name,
            )

        block_infos = [
            self._member_block(
                context.source,
                member,
            )
            for member in members
        ]

        blocks = [
            item[2].strip("\r\n")
            for item in block_infos
        ]

        blocks.insert(
            insert_index,
            member_block.strip("\r\n"),
        )

        region_start = min(
            item[0]
            for item in block_infos
        )

        region_end = max(
            item[1]
            for item in block_infos
        )

        replacement = "\n\n".join(blocks)

        original_region = context.source[
            utf16_offset_to_python_index(
                context.source,
                region_start,
            ):
            utf16_offset_to_python_index(
                context.source,
                region_end,
            )
        ]

        if original_region.endswith(
            ("\n", "\r")
        ):
            replacement += "\n"

        return MemberAddPlan(
            edits=(
                MemberAddEdit(
                    start=region_start,
                    end=region_end,
                    text=replacement,
                ),
            ),
            direction=direction,
            member_name=context.member_name,
            member_kind=context.member_kind,
            target_name=target_name,
        )

    def _validate_context(
        self,
        context: MemberAddContext,
    ) -> None:
        if (
            context.member_kind
            not in self._KINDS
        ):
            raise InvalidMemberAdd(
                "member_kind must be constructor, "
                "method, property, getter, or setter"
            )

        if not context.member_name.strip():
            raise InvalidMemberAdd(
                "member_name cannot be empty"
            )

        if not context.member_text.strip():
            raise InvalidMemberAdd(
                "member_text cannot be empty"
            )

        options = (
            context.before is not None,
            context.after is not None,
            context.position is not None,
        )

        if sum(options) > 1:
            raise InvalidMemberAdd(
                "At most one of before, after or "
                "position may be provided"
            )

        if (
            context.position is not None
            and context.position
            not in {"top", "bottom"}
        ):
            raise InvalidMemberAdd(
                "position must be 'top' or 'bottom'"
            )

    @staticmethod
    def _validate_conflict(
        members: tuple[
            ClassMemberNode,
            ...
        ],
        name: str,
        kind: str,
    ) -> None:
        if kind == "constructor":
            if any(
                member.kind == "constructor"
                for member in members
            ):
                raise MemberAddConflict(
                    "Class already contains a "
                    "constructor"
                )

            return

        same_name = tuple(
            member
            for member in members
            if member.name == name
        )

        if not same_name:
            return

        if kind == "getter":
            if all(
                member.kind == "setter"
                for member in same_name
            ):
                return

        if kind == "setter":
            if all(
                member.kind == "getter"
                for member in same_name
            ):
                return

        raise MemberAddConflict(
            f"Class already contains a conflicting "
            f"member named {name!r}"
        )

    def _resolve_destination(
        self,
        members: tuple[
            ClassMemberNode,
            ...
        ],
        *,
        before: str | None,
        after: str | None,
        position: str | None,
    ) -> tuple[
        MemberAddDirection,
        str | None,
        int,
    ]:
        if before is not None:
            target_index = self._target_index(
                members,
                before,
            )

            return (
                MemberAddDirection.BEFORE,
                before,
                target_index,
            )

        if after is not None:
            target_index = self._target_index(
                members,
                after,
            )

            return (
                MemberAddDirection.AFTER,
                after,
                target_index + 1,
            )

        if position == "top":
            return (
                MemberAddDirection.TOP,
                None,
                0,
            )

        return (
            MemberAddDirection.BOTTOM,
            None,
            len(members),
        )

    @staticmethod
    def _target_index(
        members: tuple[
            ClassMemberNode,
            ...
        ],
        name: str,
    ) -> int:
        matches = [
            index
            for index, member
            in enumerate(members)
            if member.name == name
        ]

        if not matches:
            raise InvalidMemberAdd(
                f"Target member {name!r} "
                "was not found"
            )

        if len(matches) > 1:
            raise InvalidMemberAdd(
                f"More than one target member "
                f"named {name!r} was found"
            )

        return matches[0]

    def _indent_member(
        self,
        source: str,
        class_node: ClassNode,
        members: tuple[
            ClassMemberNode,
            ...
        ],
        member_text: str,
    ) -> str:
        indent = self._member_indent(
            source,
            class_node,
            members,
        )

        normalized = (
            member_text
            .strip("\r\n")
        )

        lines = normalized.splitlines()

        return "\n".join(
            (
                indent + line
                if line.strip()
                else ""
            )
            for line in lines
        )

    @staticmethod
    def _member_indent(
        source: str,
        class_node: ClassNode,
        members: tuple[
            ClassMemberNode,
            ...
        ],
    ) -> str:
        if members:
            first_start = (
                utf16_offset_to_python_index(
                    source,
                    members[0].member_start,
                )
            )

            line_start = (
                source.rfind(
                    "\n",
                    0,
                    first_start,
                )
                + 1
            )

            prefix = source[
                line_start:
                first_start
            ]

            if not prefix.strip():
                return prefix

        class_start = (
            utf16_offset_to_python_index(
                source,
                class_node.class_start,
            )
        )

        line_start = (
            source.rfind(
                "\n",
                0,
                class_start,
            )
            + 1
        )

        class_prefix = source[
            line_start:
            class_start
        ]

        if class_prefix.strip():
            class_prefix = ""

        return class_prefix + "  "

    @staticmethod
    def _empty_class_edit(
        source: str,
        class_node: ClassNode,
        member_block: str,
    ) -> MemberAddEdit:
        class_end_python = (
            utf16_offset_to_python_index(
                source,
                class_node.class_end,
            )
        )

        closing_brace_python = (
            class_end_python - 1
        )

        if (
            closing_brace_python < 0
            or source[
                closing_brace_python
            ] != "}"
        ):
            raise InvalidMemberAdd(
                "Could not locate class closing brace"
            )

        insert_offset = utf16_length(
            source[:closing_brace_python]
        )

        before_brace = source[
            max(0, closing_brace_python - 1):
            closing_brace_python
        ]

        if before_brace in {
            "\n",
            "\r",
        }:
            text = (
                member_block
                .strip("\r\n")
                + "\n"
            )
        else:
            text = (
                "\n"
                + member_block
                .strip("\r\n")
                + "\n"
            )

        return MemberAddEdit(
            start=insert_offset,
            end=insert_offset,
            text=text,
        )

    def _member_block(
        self,
        source: str,
        member: ClassMemberNode,
    ) -> tuple[int, int, str]:
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

        expanded_start = utf16_length(
            source[:expanded_python_start]
        )

        return (
            expanded_start,
            end,
            source[
                expanded_python_start:
                python_end
            ],
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
                opening = source.rfind(
                    "/*",
                    0,
                    previous_line_end,
                )

                if opening < 0:
                    break

                opening_line_start = (
                    source.rfind(
                        "\n",
                        0,
                        opening,
                    )
                    + 1
                )

                if source[
                    opening_line_start:
                    opening
                ].strip():
                    break

                current_start = (
                    opening_line_start
                )
                continue

            break

        return current_start
