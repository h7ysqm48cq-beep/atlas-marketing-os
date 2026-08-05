from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.class_update import (
    ClassUpdateContext,
    ClassUpdatePlanner,
    InvalidClassUpdate,
)
from tools.modifier.enum_update import (
    EnumUpdateContext,
    EnumUpdatePlanner,
    InvalidEnumUpdate,
)
from tools.modifier.function_update import (
    FunctionUpdateContext,
    FunctionUpdatePlanner,
    InvalidFunctionUpdate,
)
from tools.modifier.interface_update import (
    InterfaceUpdateContext,
    InterfaceUpdatePlanner,
    InvalidInterfaceUpdate,
)
from tools.modifier.member_update import (
    InvalidMemberUpdate,
    MemberUpdateContext,
    MemberUpdatePlanner,
)
from tools.modifier.type_alias_update import (
    InvalidTypeAliasUpdate,
    TypeAliasUpdateContext,
    TypeAliasUpdatePlanner,
)
from tools.modifier.variable_update import (
    InvalidVariableUpdate,
    VariableUpdateContext,
    VariableUpdatePlanner,
)


def declaration(
    *,
    kind: str,
    name: str | None = "Example",
    start: int = 10,
    end: int = 30,
    declarators: tuple[object, ...] = (),
):
    return SimpleNamespace(
        kind=kind,
        name=name,
        declaration_start=start,
        declaration_end=end,
        variable_declarators=declarators,
    )


def variable_declarator(
    *,
    names: tuple[str, ...] = ("value",),
    destructuring: bool = False,
):
    return SimpleNamespace(
        names=names,
        destructuring=destructuring,
    )


@pytest.mark.parametrize(
    (
        "planner",
        "context_name",
    ),
    (
        (
            ClassUpdatePlanner(),
            "ClassUpdateContext",
        ),
        (
            EnumUpdatePlanner(),
            "EnumUpdateContext",
        ),
        (
            FunctionUpdatePlanner(),
            "FunctionUpdateContext",
        ),
        (
            InterfaceUpdatePlanner(),
            "InterfaceUpdateContext",
        ),
        (
            TypeAliasUpdatePlanner(),
            "TypeAliasUpdateContext",
        ),
        (
            VariableUpdatePlanner(),
            "VariableUpdateContext",
        ),
        (
            MemberUpdatePlanner(),
            "MemberUpdateContext",
        ),
    ),
)
def test_wrong_context_type_rejected(
    planner,
    context_name: str,
) -> None:
    with pytest.raises(
        TypeError,
        match=context_name,
    ):
        planner.plan("invalid")


class TestClassUpdate:
    def context(
        self,
        *,
        existing_kind: str = "class",
        replacement_kind: str = "class",
        existing_name: str | None = "UserService",
        replacement_name: str | None = "UserService",
        replacement_text: str = (
            "class UserService {}"
        ),
    ) -> ClassUpdateContext:
        return ClassUpdateContext(
            declaration=declaration(
                kind=existing_kind,
                name=existing_name,
            ),
            replacement=declaration(
                kind=replacement_kind,
                name=replacement_name,
            ),
            replacement_text=replacement_text,
        )

    def test_existing_kind_rejected(self) -> None:
        with pytest.raises(
            InvalidClassUpdate,
            match="Existing declaration",
        ):
            ClassUpdatePlanner().plan(
                self.context(
                    existing_kind="function",
                )
            )

    def test_replacement_kind_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidClassUpdate,
            match="Replacement declaration",
        ):
            ClassUpdatePlanner().plan(
                self.context(
                    replacement_kind="function",
                )
            )

    def test_existing_anonymous_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidClassUpdate,
            match="Anonymous existing",
        ):
            ClassUpdatePlanner().plan(
                self.context(
                    existing_name=None,
                )
            )

    def test_replacement_anonymous_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidClassUpdate,
            match="Anonymous replacement",
        ):
            ClassUpdatePlanner().plan(
                self.context(
                    replacement_name=None,
                )
            )

    def test_name_mismatch_rejected(self) -> None:
        with pytest.raises(
            InvalidClassUpdate,
            match="does not match",
        ):
            ClassUpdatePlanner().plan(
                self.context(
                    replacement_name="Other",
                )
            )

    def test_empty_text_rejected(self) -> None:
        with pytest.raises(
            InvalidClassUpdate,
            match="cannot be empty",
        ):
            ClassUpdatePlanner().plan(
                self.context(
                    replacement_text="\r\n \n",
                )
            )

    def test_valid_plan(self) -> None:
        plan = ClassUpdatePlanner().plan(
            self.context(
                replacement_text=(
                    "\nclass UserService {\n}\r\n"
                )
            )
        )

        assert plan.class_name == "UserService"
        assert (
            plan.replacement_name
            == "UserService"
        )
        assert plan.edits[0].start == 10
        assert plan.edits[0].end == 30
        assert (
            plan.edits[0].text
            == "class UserService {\n}"
        )


class TestEnumUpdate:
    def context(
        self,
        *,
        existing_kind: str = "enum",
        replacement_kind: str = "enum",
        existing_name: str | None = "Status",
        replacement_name: str | None = "Status",
        replacement_text: str = (
            "enum Status { Active }"
        ),
    ) -> EnumUpdateContext:
        return EnumUpdateContext(
            declaration=declaration(
                kind=existing_kind,
                name=existing_name,
            ),
            replacement=declaration(
                kind=replacement_kind,
                name=replacement_name,
            ),
            replacement_text=replacement_text,
        )

    @pytest.mark.parametrize(
        (
            "kwargs",
            "message",
        ),
        (
            (
                {"existing_kind": "class"},
                "Existing declaration",
            ),
            (
                {"replacement_kind": "class"},
                "Replacement declaration",
            ),
            (
                {"existing_name": None},
                "Anonymous existing",
            ),
            (
                {"replacement_name": None},
                "Anonymous replacement",
            ),
            (
                {"replacement_name": "Other"},
                "does not match",
            ),
            (
                {"replacement_text": "\n \r\n"},
                "cannot be empty",
            ),
        ),
    )
    def test_invalid_cases(
        self,
        kwargs: dict[str, object],
        message: str,
    ) -> None:
        with pytest.raises(
            InvalidEnumUpdate,
            match=message,
        ):
            EnumUpdatePlanner().plan(
                self.context(**kwargs)
            )

    def test_valid_plan(self) -> None:
        plan = EnumUpdatePlanner().plan(
            self.context()
        )

        assert plan.enum_name == "Status"
        assert plan.edits[0].start == 10
        assert plan.edits[0].end == 30


class TestFunctionUpdate:
    def context(
        self,
        *,
        existing_kind: str = "function",
        replacement_kind: str = "function",
        existing_name: str | None = "run",
        replacement_name: str | None = "run",
        replacement_text: str = (
            "function run() {}"
        ),
    ) -> FunctionUpdateContext:
        return FunctionUpdateContext(
            declaration=declaration(
                kind=existing_kind,
                name=existing_name,
            ),
            replacement=declaration(
                kind=replacement_kind,
                name=replacement_name,
            ),
            replacement_text=replacement_text,
        )

    @pytest.mark.parametrize(
        (
            "kwargs",
            "message",
        ),
        (
            (
                {"existing_kind": "class"},
                "Existing declaration",
            ),
            (
                {"replacement_kind": "class"},
                "Replacement declaration",
            ),
            (
                {"existing_name": None},
                "Anonymous existing",
            ),
            (
                {"replacement_name": None},
                "Anonymous replacement",
            ),
            (
                {"replacement_name": "stop"},
                "does not match",
            ),
            (
                {"replacement_text": " \n "},
                "cannot be empty",
            ),
        ),
    )
    def test_invalid_cases(
        self,
        kwargs: dict[str, object],
        message: str,
    ) -> None:
        with pytest.raises(
            InvalidFunctionUpdate,
            match=message,
        ):
            FunctionUpdatePlanner().plan(
                self.context(**kwargs)
            )

    def test_valid_plan(self) -> None:
        plan = FunctionUpdatePlanner().plan(
            self.context()
        )

        assert plan.function_name == "run"
        assert plan.replacement_name == "run"


class TestInterfaceUpdate:
    def context(
        self,
        *,
        existing_kind: str = "interface",
        replacement_kind: str = "interface",
        existing_name: str | None = "User",
        replacement_name: str | None = "User",
        replacement_text: str = (
            "interface User {}"
        ),
    ) -> InterfaceUpdateContext:
        return InterfaceUpdateContext(
            declaration=declaration(
                kind=existing_kind,
                name=existing_name,
            ),
            replacement=declaration(
                kind=replacement_kind,
                name=replacement_name,
            ),
            replacement_text=replacement_text,
        )

    @pytest.mark.parametrize(
        (
            "kwargs",
            "message",
        ),
        (
            (
                {"existing_kind": "type"},
                "Existing declaration",
            ),
            (
                {"replacement_kind": "type"},
                "Replacement declaration",
            ),
            (
                {"existing_name": None},
                "Anonymous existing",
            ),
            (
                {"replacement_name": None},
                "Anonymous replacement",
            ),
            (
                {"replacement_name": "Other"},
                "does not match",
            ),
            (
                {"replacement_text": "\r\n"},
                "cannot be empty",
            ),
        ),
    )
    def test_invalid_cases(
        self,
        kwargs: dict[str, object],
        message: str,
    ) -> None:
        with pytest.raises(
            InvalidInterfaceUpdate,
            match=message,
        ):
            InterfaceUpdatePlanner().plan(
                self.context(**kwargs)
            )

    def test_valid_plan(self) -> None:
        plan = InterfaceUpdatePlanner().plan(
            self.context()
        )

        assert plan.interface_name == "User"
        assert plan.replacement_name == "User"


class TestTypeAliasUpdate:
    def context(
        self,
        *,
        existing_kind: str = "type",
        replacement_kind: str = "type",
        existing_name: str | None = "UserId",
        replacement_name: str | None = "UserId",
        replacement_text: str = (
            "type UserId = string;"
        ),
    ) -> TypeAliasUpdateContext:
        return TypeAliasUpdateContext(
            declaration=declaration(
                kind=existing_kind,
                name=existing_name,
            ),
            replacement=declaration(
                kind=replacement_kind,
                name=replacement_name,
            ),
            replacement_text=replacement_text,
        )

    @pytest.mark.parametrize(
        (
            "kwargs",
            "message",
        ),
        (
            (
                {"existing_kind": "interface"},
                "Existing declaration",
            ),
            (
                {"replacement_kind": "interface"},
                "Replacement declaration",
            ),
            (
                {"existing_name": None},
                "Anonymous existing",
            ),
            (
                {"replacement_name": None},
                "Anonymous replacement",
            ),
            (
                {"replacement_name": "Other"},
                "does not match",
            ),
            (
                {"replacement_text": "\n\t\n"},
                "cannot be empty",
            ),
        ),
    )
    def test_invalid_cases(
        self,
        kwargs: dict[str, object],
        message: str,
    ) -> None:
        with pytest.raises(
            InvalidTypeAliasUpdate,
            match=message,
        ):
            TypeAliasUpdatePlanner().plan(
                self.context(**kwargs)
            )

    def test_valid_plan(self) -> None:
        plan = TypeAliasUpdatePlanner().plan(
            self.context()
        )

        assert plan.type_name == "UserId"
        assert plan.replacement_name == "UserId"


class TestVariableUpdate:
    def context(
        self,
        *,
        existing_kind: str = "variable",
        replacement_kind: str = "variable",
        existing_declarators: tuple[
            object,
            ...
        ] | None = None,
        replacement_declarators: tuple[
            object,
            ...
        ] | None = None,
        variable_name: str = "value",
        replacement_text: str = (
            "const value = 2;"
        ),
    ) -> VariableUpdateContext:
        if existing_declarators is None:
            existing_declarators = (
                variable_declarator(),
            )

        if replacement_declarators is None:
            replacement_declarators = (
                variable_declarator(),
            )

        return VariableUpdateContext(
            declaration=declaration(
                kind=existing_kind,
                declarators=(
                    existing_declarators
                ),
            ),
            replacement=declaration(
                kind=replacement_kind,
                declarators=(
                    replacement_declarators
                ),
            ),
            variable_name=variable_name,
            replacement_text=replacement_text,
        )

    def test_existing_kind_rejected(self) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="Existing declaration",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    existing_kind="class",
                )
            )

    def test_replacement_kind_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="Replacement declaration",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    replacement_kind="class",
                )
            )

    def test_existing_multiple_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="multi-variable",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    existing_declarators=(
                        variable_declarator(),
                        variable_declarator(
                            names=("other",),
                        ),
                    ),
                )
            )

    def test_replacement_count_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="exactly one",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    replacement_declarators=(),
                )
            )

    @pytest.mark.parametrize(
        "declarator",
        (
            variable_declarator(
                destructuring=True,
            ),
            variable_declarator(
                names=("a", "b"),
            ),
        ),
    )
    def test_existing_destructuring_rejected(
        self,
        declarator,
    ) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="destructuring",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    existing_declarators=(
                        declarator,
                    ),
                )
            )

    @pytest.mark.parametrize(
        "declarator",
        (
            variable_declarator(
                destructuring=True,
            ),
            variable_declarator(
                names=("a", "b"),
            ),
        ),
    )
    def test_replacement_destructuring_rejected(
        self,
        declarator,
    ) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="Replacement destructuring",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    replacement_declarators=(
                        declarator,
                    ),
                )
            )

    def test_requested_name_mismatch_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="requested name",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    variable_name="other",
                )
            )

    def test_replacement_name_mismatch_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="does not match",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    replacement_declarators=(
                        variable_declarator(
                            names=("other",),
                        ),
                    ),
                )
            )

    def test_empty_text_rejected(self) -> None:
        with pytest.raises(
            InvalidVariableUpdate,
            match="cannot be empty",
        ):
            VariableUpdatePlanner().plan(
                self.context(
                    replacement_text="\n \r\n",
                )
            )

    def test_valid_plan(self) -> None:
        plan = VariableUpdatePlanner().plan(
            self.context(
                replacement_text=(
                    "\nconst value = 2;\r\n"
                )
            )
        )

        assert plan.variable_name == "value"
        assert plan.replacement_name == "value"
        assert (
            plan.edits[0].text
            == "const value = 2;"
        )


def member(
    *,
    kind: str = "method",
    name: str = "run",
):
    return SimpleNamespace(
        kind=kind,
        name=name,
        member_start=20,
        member_end=40,
    )


class TestMemberUpdate:
    def context(
        self,
        *,
        member_kind: str = "method",
        replacement_kind: str = "method",
        member_name: str = "run",
        replacement_name: str = "run",
        replacement_text: str = (
            "run(): void {}"
        ),
    ) -> MemberUpdateContext:
        return MemberUpdateContext(
            class_name="UserService",
            member=member(
                kind=member_kind,
                name=member_name,
            ),
            replacement=member(
                kind=replacement_kind,
                name=replacement_name,
            ),
            replacement_text=replacement_text,
        )

    def test_existing_kind_rejected(self) -> None:
        with pytest.raises(
            InvalidMemberUpdate,
            match="Unsupported existing",
        ):
            MemberUpdatePlanner().plan(
                self.context(
                    member_kind="index_signature",
                )
            )

    def test_replacement_kind_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidMemberUpdate,
            match="Unsupported replacement",
        ):
            MemberUpdatePlanner().plan(
                self.context(
                    replacement_kind=(
                        "index_signature"
                    ),
                )
            )

    def test_kind_mismatch_rejected(self) -> None:
        with pytest.raises(
            InvalidMemberUpdate,
            match="kind does not match",
        ):
            MemberUpdatePlanner().plan(
                self.context(
                    replacement_kind="property",
                )
            )

    def test_name_mismatch_rejected(self) -> None:
        with pytest.raises(
            InvalidMemberUpdate,
            match="name does not match",
        ):
            MemberUpdatePlanner().plan(
                self.context(
                    replacement_name="stop",
                )
            )

    def test_empty_text_rejected(self) -> None:
        with pytest.raises(
            InvalidMemberUpdate,
            match="cannot be empty",
        ):
            MemberUpdatePlanner().plan(
                self.context(
                    replacement_text="\n \r\n",
                )
            )

    @pytest.mark.parametrize(
        "kind",
        (
            "constructor",
            "method",
            "property",
            "getter",
            "setter",
        ),
    )
    def test_supported_kinds(
        self,
        kind: str,
    ) -> None:
        name = (
            "constructor"
            if kind == "constructor"
            else "value"
        )

        plan = MemberUpdatePlanner().plan(
            self.context(
                member_kind=kind,
                replacement_kind=kind,
                member_name=name,
                replacement_name=name,
                replacement_text=(
                    f"\n{name}: unknown;\r\n"
                ),
            )
        )

        assert plan.member_kind == kind
        assert plan.replacement_kind == kind
        assert plan.edits[0].start == 20
        assert plan.edits[0].end == 40
        assert (
            plan.edits[0].text
            == f"{name}: unknown;"
        )
