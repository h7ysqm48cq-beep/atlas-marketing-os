from __future__ import annotations

import re

from .intent import (
    EngineeringIntent,
    IntentType,
)


IDENTIFIER = (
    r"[A-Za-z_$][A-Za-z0-9_$]*"
)

RESOURCE = (
    r"[A-Za-z][A-Za-z0-9_-]*"
)


class IntentParserError(ValueError):
    """Raised when natural-language input is invalid."""


class RuleBasedIntentParser:
    """
    Conservative natural-language parser.

    It only returns an actionable intent when the
    required engineering arguments can be extracted
    reliably. Ambiguous UI and bug requests remain
    review-only planning intents.
    """

    _english_rename = re.compile(
        rf"\b(?:rename|change)\s+"
        rf"(?P<old>{IDENTIFIER})\s+"
        rf"(?:to|into)\s+"
        rf"(?P<new>{IDENTIFIER})\b",
        re.IGNORECASE,
    )

    _chinese_rename = re.compile(
        rf"(?:把|将)?\s*"
        rf"(?P<old>{IDENTIFIER})\s*"
        rf"(?:改名为|重命名为|改成)\s*"
        rf"(?P<new>{IDENTIFIER})",
        re.IGNORECASE,
    )

    _english_crud_resource_first = (
        re.compile(
            rf"\b(?:create|generate|build|add)"
            rf"\s+(?:a\s+)?"
            rf"(?P<resource>{RESOURCE})"
            rf"\s+crud\b",
            re.IGNORECASE,
        )
    )

    _english_crud_crud_first = re.compile(
        rf"\b(?:create|generate|build|add)"
        rf"\s+(?:a\s+)?crud"
        rf"\s+(?:for\s+)?"
        rf"(?P<resource>{RESOURCE})\b",
        re.IGNORECASE,
    )

    _chinese_crud = re.compile(
        rf"(?:建立|创建|新增|生成)"
        rf"\s*(?P<resource>{RESOURCE})"
        rf"\s*CRUD",
        re.IGNORECASE,
    )

    _english_connect = re.compile(
        rf"\b(?:inject|connect)\s+"
        rf"(?P<dependency>{IDENTIFIER})\s+"
        rf"(?:into|to)\s+"
        rf"(?P<target>{IDENTIFIER})\b",
        re.IGNORECASE,
    )

    _chinese_connect = re.compile(
        rf"(?:把|将)?\s*"
        rf"(?P<dependency>{IDENTIFIER})\s*"
        rf"(?:注入|连接到|接入)\s*"
        rf"(?P<target>{IDENTIFIER})",
        re.IGNORECASE,
    )

    _ui_words = (
        "ui",
        "dashboard",
        "page",
        "screen",
        "layout",
        "界面",
        "页面",
        "仪表板",
        "设计",
        "手机版",
    )

    _redesign_words = (
        "redesign",
        "restyle",
        "simplify",
        "modernize",
        "improve the design",
        "重新设计",
        "改漂亮",
        "优化设计",
        "简化",
        "换设计",
        "改版",
    )

    _investigate_words = (
        "fix",
        "debug",
        "investigate",
        "broken",
        "failed",
        "not working",
        "修复",
        "检查",
        "排查",
        "失败",
        "不能用",
        "有问题",
        "没有反应",
    )

    def parse(
        self,
        text: str,
    ) -> EngineeringIntent:
        if not isinstance(text, str):
            raise TypeError(
                "text must be a string"
            )

        normalized = " ".join(
            text.strip().split()
        )

        if not normalized:
            raise IntentParserError(
                "Natural-language request "
                "cannot be empty"
            )

        rename = (
            self._english_rename.search(
                normalized
            )
            or self._chinese_rename.search(
                normalized
            )
        )

        if rename is not None:
            old_name = rename.group("old")
            new_name = rename.group("new")

            return EngineeringIntent(
                intent_type=(
                    IntentType.RENAME_SYMBOL
                ),
                raw_text=normalized,
                target=old_name,
                arguments={
                    "old_name": old_name,
                    "new_name": new_name,
                },
                confidence=0.99,
            )

        for pattern in (
            self._english_crud_resource_first,
            self._english_crud_crud_first,
            self._chinese_crud,
        ):
            match = pattern.search(
                normalized
            )

            if match is not None:
                resource = (
                    match.group("resource")
                    .strip()
                    .lower()
                )

                return EngineeringIntent(
                    intent_type=(
                        IntentType.CREATE_CRUD
                    ),
                    raw_text=normalized,
                    target=resource,
                    arguments={
                        "resource_name": (
                            resource
                        ),
                    },
                    confidence=0.98,
                )

        connect = (
            self._english_connect.search(
                normalized
            )
            or self._chinese_connect.search(
                normalized
            )
        )

        if connect is not None:
            dependency = connect.group(
                "dependency"
            )
            target = connect.group(
                "target"
            )

            return EngineeringIntent(
                intent_type=(
                    IntentType
                    .CONNECT_DEPENDENCY
                ),
                raw_text=normalized,
                target=target,
                arguments={
                    "dependency_type": (
                        dependency
                    ),
                    "target_class": target,
                },
                confidence=0.88,
                requires_review=True,
                reason=(
                    "Dependency import path and "
                    "parameter name must be resolved."
                ),
            )

        lowered = normalized.lower()

        if (
            any(
                word in lowered
                for word in self._ui_words
            )
            and any(
                word in lowered
                for word
                in self._redesign_words
            )
        ):
            return EngineeringIntent(
                intent_type=(
                    IntentType.REDESIGN_UI
                ),
                raw_text=normalized,
                target=self._extract_ui_target(
                    normalized
                ),
                arguments={
                    "requirements": (
                        normalized
                    ),
                },
                confidence=0.86,
                requires_review=True,
                reason=(
                    "UI redesign requires "
                    "repository analysis before "
                    "files can be modified."
                ),
            )

        if any(
            word in lowered
            for word
            in self._investigate_words
        ):
            return EngineeringIntent(
                intent_type=(
                    IntentType
                    .INVESTIGATE_AND_FIX
                ),
                raw_text=normalized,
                target=None,
                arguments={
                    "problem": normalized,
                },
                confidence=0.75,
                requires_review=True,
                reason=(
                    "The affected files and root "
                    "cause must be investigated."
                ),
            )

        return EngineeringIntent(
            intent_type=IntentType.UNKNOWN,
            raw_text=normalized,
            confidence=0.0,
            requires_review=True,
            reason=(
                "No supported engineering intent "
                "could be identified safely."
            ),
        )

    @staticmethod
    def _extract_ui_target(
        text: str,
    ) -> str | None:
        candidates = re.findall(
            r"\b[A-Z][A-Za-z0-9]+"
            r"(?:Page|Screen|Dashboard|Studio)?\b",
            text,
        )

        if candidates:
            return candidates[0]

        lowered = text.lower()

        if "dashboard" in lowered:
            return "Dashboard"

        if "ai studio" in lowered:
            return "AI Studio"

        if "手机版" in text:
            return "Mobile UI"

        return None
