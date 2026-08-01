from __future__ import annotations

import unittest

from tools.modifier.parameter_removal import (
    ParameterRemoval,
    ParameterRemovalContext,
    ParameterRemovalPlanner,
    ParameterRemovalShape,
)


class ParameterRemovalTests(unittest.TestCase):
    def context(
        self,
        source: str,
        names: tuple[str, ...],
        target_index: int,
    ) -> ParameterRemovalContext:
        starts = tuple(
            source.index(name)
            for name in names
        )

        ends = tuple(
            start + len(name)
            for start, name in zip(
                starts,
                names,
                strict=True,
            )
        )

        constructor_start = source.index(
            "constructor"
        )

        body_start = source.index(
            "{",
            constructor_start,
        )

        return ParameterRemovalContext(
            source=source,
            constructor_start=constructor_start,
            body_start=body_start,
            parameter_starts=starts,
            parameter_ends=ends,
            target_index=target_index,
        )

    def test_plan_remove_only_parameter(
        self,
    ) -> None:
        source = """export class AppService {
  constructor(
    private readonly logger: Logger,
  ) {}
}
"""

        context = self.context(
            source,
            (
                "private readonly logger: Logger",
            ),
            0,
        )

        removal = (
            ParameterRemovalPlanner().plan(
                context
            )
        )

        opening = source.index(
            "(",
            source.index("constructor"),
        )

        closing = source.index(
            ")",
            opening,
        )

        self.assertEqual(
            removal,
            ParameterRemoval(
                start=opening + 1,
                end=closing,
                shape=(
                    ParameterRemovalShape
                    .ONLY_PARAMETER
                ),
            ),
        )

        updated = (
            source[:removal.start]
            + source[removal.end:]
        )

        self.assertIn(
            "constructor() {}",
            updated,
        )

    def test_plan_remove_first_parameter(
        self,
    ) -> None:
        source = """export class AppService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}
}
"""

        names = (
            "private readonly config: ConfigService",
            "private readonly logger: Logger",
        )

        context = self.context(
            source,
            names,
            0,
        )

        removal = (
            ParameterRemovalPlanner().plan(
                context
            )
        )

        self.assertEqual(
            removal.shape,
            ParameterRemovalShape.FIRST_PARAMETER,
        )

        self.assertEqual(
            removal.start,
            source.index(names[0]),
        )

        self.assertEqual(
            removal.end,
            source.index(names[1]),
        )

        updated = (
            source[:removal.start]
            + source[removal.end:]
        )

        self.assertNotIn(
            "config: ConfigService",
            updated,
        )

        self.assertIn(
            "logger: Logger",
            updated,
        )

    def test_plan_remove_middle_parameter(
        self,
    ) -> None:
        source = """export class AppService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
    private readonly cache: Cache,
  ) {}
}
"""

        names = (
            "private readonly config: ConfigService",
            "private readonly logger: Logger",
            "private readonly cache: Cache",
        )

        context = self.context(
            source,
            names,
            1,
        )

        removal = (
            ParameterRemovalPlanner().plan(
                context
            )
        )

        self.assertEqual(
            removal.shape,
            ParameterRemovalShape.MIDDLE_PARAMETER,
        )

        self.assertEqual(
            removal.start,
            source.index(names[1]),
        )

        self.assertEqual(
            removal.end,
            source.index(names[2]),
        )

        updated = (
            source[:removal.start]
            + source[removal.end:]
        )

        self.assertNotIn(
            "logger: Logger",
            updated,
        )

        self.assertIn(
            "config: ConfigService",
            updated,
        )

        self.assertIn(
            "cache: Cache",
            updated,
        )

    def test_plan_remove_last_parameter(
        self,
    ) -> None:
        source = """export class AppService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}
}
"""

        names = (
            "private readonly config: ConfigService",
            "private readonly logger: Logger",
        )

        context = self.context(
            source,
            names,
            1,
        )

        removal = (
            ParameterRemovalPlanner().plan(
                context
            )
        )

        self.assertEqual(
            removal.shape,
            ParameterRemovalShape.LAST_PARAMETER,
        )

        self.assertEqual(
            removal.start,
            source.index(names[0]) + len(names[0]),
        )

        self.assertEqual(
            removal.end,
            source.index(names[1]) + len(names[1]),
        )

        updated = (
            source[:removal.start]
            + source[removal.end:]
        )

        self.assertNotIn(
            "logger: Logger",
            updated,
        )

        self.assertIn(
            "config: ConfigService",
            updated,
        )

    def test_context_rejects_invalid_target_index(
        self,
    ) -> None:
        source = """export class AppService {
  constructor(private logger: Logger) {}
}
"""

        start = source.index(
            "private logger: Logger"
        )

        with self.assertRaises(ValueError):
            ParameterRemovalContext(
                source=source,
                constructor_start=(
                    source.index("constructor")
                ),
                body_start=source.index("{", 1),
                parameter_starts=(start,),
                parameter_ends=(
                    start
                    + len("private logger: Logger"),
                ),
                target_index=1,
            )

    def test_context_rejects_mismatched_ranges(
        self,
    ) -> None:
        source = """export class AppService {
  constructor(private logger: Logger) {}
}
"""

        start = source.index(
            "private logger: Logger"
        )

        with self.assertRaises(ValueError):
            ParameterRemovalContext(
                source=source,
                constructor_start=(
                    source.index("constructor")
                ),
                body_start=source.index("{", 1),
                parameter_starts=(start,),
                parameter_ends=(),
                target_index=0,
            )

    def test_planner_rejects_wrong_context_type(
        self,
    ) -> None:
        with self.assertRaises(TypeError):
            ParameterRemovalPlanner().plan(
                "not a context"  # type: ignore[arg-type]
            )


if __name__ == "__main__":
    unittest.main()
