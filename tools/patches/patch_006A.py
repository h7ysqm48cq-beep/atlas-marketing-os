from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "006A",
    "name": "Install Atlas Upgrade Framework",
    "version": "1.0.0",
    "requires": ["005"],
    "build": [],
    "description": (
        "Verifies the patch framework and installs "
        "repository ignore rules."
    ),
}


def apply(context: PatchContext) -> None:
    context.append_once(
        ".gitignore",
        """
        # Atlas local patch framework
        tools/backups/
        __pycache__/
        *.pyc
        """,
    )

    context.write_text(
        "tools/.framework-installed",
        "Atlas Upgrade Framework V1\n",
    )
