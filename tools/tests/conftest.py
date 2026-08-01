from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest


@pytest.fixture
def project_root() -> Path:
    return Path.cwd().resolve()


@pytest.fixture
def temp_workspace(
    project_root: Path,
) -> Iterator[Path]:
    with TemporaryDirectory(
        dir=project_root,
    ) as directory:
        yield Path(directory)
