from __future__ import annotations

from dataclasses import dataclass

from .ast_navigator import ClassMemberNode


class MemberUpdateError(ValueError):
    """Base class member update error."""


class InvalidMemberUpdate(MemberUpdateError):
    """Raised when a member update is invalid."""


@dataclass(frozen=True, slots=True)
class MemberUpdateEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class MemberUpdatePlan:
    edits: tuple[MemberUpdateEdit, ...]
    class_name: str
    member_name: str
    member_kind: str
    replacement_name: str
    replacement_kind: str


@dataclass(frozen=True, slots=True)
class MemberUpdateContext:
    class_name: str
    member: ClassMemberNode
    replacement: ClassMemberNode
    replacement_text: str


class MemberUpdatePlanner:
    _KINDS = {
        "constructor",
        "method",
        "property",
        "getter",
        "setter",
    }

    def plan(
        self,
        context: MemberUpdateContext,
    ) -> MemberUpdatePlan:
        if not isinstance(
            context,
            MemberUpdateContext,
        ):
            raise TypeError(
                "context must be a "
                "MemberUpdateContext"
            )

        member = context.member
        replacement = context.replacement

        if member.kind not in self._KINDS:
            raise InvalidMemberUpdate(
                f"Unsupported existing member "
                f"kind: {member.kind!r}"
            )

        if replacement.kind not in self._KINDS:
            raise InvalidMemberUpdate(
                f"Unsupported replacement member "
                f"kind: {replacement.kind!r}"
            )

        if (
            replacement.kind
            != member.kind
        ):
            raise InvalidMemberUpdate(
                "Replacement member kind does not "
                "match the existing member kind: "
                f"{member.kind!r} != "
                f"{replacement.kind!r}"
            )

        if (
            replacement.name
            != member.name
        ):
            raise InvalidMemberUpdate(
                "Replacement member name does not "
                "match the existing member name: "
                f"{member.name!r} != "
                f"{replacement.name!r}"
            )

        replacement_text = (
            context.replacement_text
            .strip("\r\n")
        )

        if not replacement_text.strip():
            raise InvalidMemberUpdate(
                "replacement_text cannot be empty"
            )

        return MemberUpdatePlan(
            edits=(
                MemberUpdateEdit(
                    start=member.member_start,
                    end=member.member_end,
                    text=replacement_text,
                ),
            ),
            class_name=context.class_name,
            member_name=member.name,
            member_kind=member.kind,
            replacement_name=(
                replacement.name
            ),
            replacement_kind=(
                replacement.kind
            ),
        )
