from __future__ import annotations

from tools.repository import (
    RepositoryCache,
)


def write_service(
    tmp_path,
    class_name: str,
):
    target = tmp_path / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            f"export class {class_name} "
            "{}\n"
        ),
        encoding="utf-8",
    )

    return target


def test_returns_same_cached_project(
    tmp_path,
):
    write_service(
        tmp_path,
        "AppService",
    )

    cache = RepositoryCache(
        ttl_seconds=60,
    )

    first = cache.get(tmp_path)
    second = cache.get(tmp_path)

    assert first is second
    assert cache.size == 1


def test_file_change_invalidates_cache(
    tmp_path,
):
    target = write_service(
        tmp_path,
        "AppService",
    )

    cache = RepositoryCache(
        ttl_seconds=60,
    )

    first = cache.get(tmp_path)

    target.write_text(
        "export class NewService {}\n",
        encoding="utf-8",
    )

    second = cache.get(tmp_path)

    assert first is not second
    assert (
        second.find_symbol(
            "NewService"
        )
        is not None
    )


def test_manual_invalidation(
    tmp_path,
):
    write_service(
        tmp_path,
        "AppService",
    )

    cache = RepositoryCache()

    first = cache.get(tmp_path)

    assert cache.contains(tmp_path)
    assert cache.invalidate(tmp_path)
    assert not cache.contains(tmp_path)

    second = cache.get(tmp_path)

    assert first is not second


def test_clear_removes_all_entries(
    tmp_path,
):
    first_root = tmp_path / "one"
    second_root = tmp_path / "two"

    write_service(
        first_root,
        "FirstService",
    )
    write_service(
        second_root,
        "SecondService",
    )

    cache = RepositoryCache()

    cache.get(first_root)
    cache.get(second_root)

    assert cache.size == 2

    cache.clear()

    assert cache.size == 0
