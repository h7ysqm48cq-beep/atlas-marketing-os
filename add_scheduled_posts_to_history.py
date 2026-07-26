from pathlib import Path
import shutil
import sys

PATH = Path(
    "apps/api/src/history/history.service.ts"
)


def backup(path: Path) -> None:
    target = path.with_suffix(
        path.suffix + ".bak.scheduled-posts"
    )
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def main() -> None:
    if not PATH.exists():
        print(
            f"File not found: {PATH}",
            file=sys.stderr,
        )
        sys.exit(1)

    text = PATH.read_text(encoding="utf-8")
    original = text

    list_old = '''      include: {
        brand: {
          select: {
            id: true,
            name: true,
            workspace: { select: { id: true, name: true, slug: true } },
          },
        },
        campaign: { select: { id: true, name: true } },
        idea: { select: { id: true, title: true, sortOrder: true } },
      },
'''

    list_new = '''      include: {
        brand: {
          select: {
            id: true,
            name: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        idea: {
          select: {
            id: true,
            title: true,
            sortOrder: true,
          },
        },
        scheduledPosts: {
          orderBy: {
            scheduledAt: 'desc',
          },
          include: {
            channel: {
              select: {
                id: true,
                name: true,
                username: true,
                externalId: true,
              },
            },
          },
        },
      },
'''

    if "scheduledPosts:" not in text:
        if list_old not in text:
            raise RuntimeError(
                "Could not find list() include block."
            )

        text = text.replace(
            list_old,
            list_new,
            1,
        )

    get_old = '''      include: {
        brand: { include: { workspace: true } },
        campaign: true,
        idea: true,
      },
'''

    get_new = '''      include: {
        brand: {
          include: {
            workspace: true,
          },
        },
        campaign: true,
        idea: true,
        scheduledPosts: {
          orderBy: {
            scheduledAt: 'desc',
          },
          include: {
            channel: true,
            attempts: {
              orderBy: {
                attemptNumber: 'desc',
              },
            },
          },
        },
      },
'''

    if "attempts:" not in text:
        if get_old not in text:
            raise RuntimeError(
                "Could not find get() include block."
            )

        text = text.replace(
            get_old,
            get_new,
            1,
        )

    if text == original:
        print(
            "HistoryService already includes scheduled posts."
        )
        return

    backup(PATH)

    PATH.write_text(
        text,
        encoding="utf-8",
    )

    print(
        "Updated history.service.ts"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            f"Patch failed: {error}",
            file=sys.stderr,
        )
        sys.exit(1)
