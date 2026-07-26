from pathlib import Path
import shutil
import sys


PUBLISHER = Path(
    "apps/api/src/automation/publisher.service.ts"
)

CALENDAR = Path(
    "apps/web/src/components/calendar/ContentCalendar.tsx"
)


def backup(path: Path, suffix: str) -> None:
    target = path.with_suffix(
        path.suffix + suffix
    )
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def patch_publisher() -> None:
    text = PUBLISHER.read_text(
        encoding="utf-8"
    )

    original = text

    import_old = """import {
  ScheduledPostStatus,
  PublishAttemptStatus,
  SocialPlatform,
} from "../generated/prisma/enums";
"""

    import_new = """import {
  ScheduledPostStatus,
  PublishAttemptStatus,
  SocialPlatform,
  ContentStatus,
} from "../generated/prisma/enums";
"""

    if "ContentStatus," not in text:
        if import_old not in text:
            raise RuntimeError(
                "Could not find publisher enum import block."
            )

        text = text.replace(
            import_old,
            import_new,
            1,
        )

    marker = """        await this.prisma.scheduledPost.update({
          where: {
            id: post.id,
          },
          data: {
            status:
              ScheduledPostStatus.PUBLISHED,
            publishedAt:
              new Date(),
            retryCount:
              post.retryCount + 1,
            externalPostId:
              result?.postId ??
              result?.post_id ??
              result?.id ??
              result?.messageId?.toString() ??
              result?.message_id?.toString() ??
              null,
"""

    if marker not in text:
        raise RuntimeError(
            "Could not find successful scheduledPost update."
        )

    sync_marker = """        published++;

"""

    sync_code = """        if (post.historyId) {
          await this.prisma.generationHistory.update({
            where: {
              id: post.historyId,
            },
            data: {
              status:
                ContentStatus.PUBLISHED,
              publishedAt:
                new Date(),
            },
          });
        }

        published++;

"""

    if (
        "this.prisma.generationHistory.update"
        not in text
    ):
        if sync_marker not in text:
            raise RuntimeError(
                "Could not find published counter marker."
            )

        text = text.replace(
            sync_marker,
            sync_code,
            1,
        )

    if text == original:
        print(
            "publisher.service.ts already patched."
        )
        return

    backup(
        PUBLISHER,
        ".bak.history-sync",
    )

    PUBLISHER.write_text(
        text,
        encoding="utf-8",
    )

    print(
        "Updated publisher.service.ts"
    )


def patch_calendar() -> None:
    text = CALENDAR.read_text(
        encoding="utf-8"
    )

    original = text

    state_marker = """  const [hoveredPostId, setHoveredPostId] =
"""

    state_code = """  const [expandedDays, setExpandedDays] =
    useState<Set<string>>(
      () => new Set(),
    );

  const [hoveredPostId, setHoveredPostId] =
"""

    if "const [expandedDays" not in text:
        if state_marker not in text:
            raise RuntimeError(
                "Could not find calendar state marker."
            )

        text = text.replace(
            state_marker,
            state_code,
            1,
        )

    slice_old = """                    {dayPosts
                      .slice(0, 3)
                      .map((post) => (
"""

    slice_new = """                    {(expandedDays.has(key)
                      ? dayPosts
                      : dayPosts.slice(0, 3)
                    ).map((post) => (
"""

    if slice_old in text:
        text = text.replace(
            slice_old,
            slice_new,
            1,
        )
    elif "expandedDays.has(key)" not in text:
        raise RuntimeError(
            "Could not find dayPosts slice block."
        )

    more_old = """                    {dayPosts.length > 3 ? (
                      <small>
                        +{dayPosts.length - 3} more
                      </small>
                    ) : null}
"""

    more_new = """                    {dayPosts.length > 3 ? (
                      <button
                        type="button"
                        className={
                          styles.morePostsButton
                        }
                        onClick={(event) => {
                          event.stopPropagation();

                          setExpandedDays(
                            (current) => {
                              const next =
                                new Set(current);

                              if (next.has(key)) {
                                next.delete(key);
                              } else {
                                next.add(key);
                              }

                              return next;
                            },
                          );
                        }}
                      >
                        {expandedDays.has(key)
                          ? "Show less"
                          : `+${dayPosts.length - 3} more`}
                      </button>
                    ) : null}
"""

    if more_old in text:
        text = text.replace(
            more_old,
            more_new,
            1,
        )
    elif "styles.morePostsButton" not in text:
        raise RuntimeError(
            "Could not find +more calendar block."
        )

    if text == original:
        print(
            "ContentCalendar.tsx already patched."
        )
        return

    backup(
        CALENDAR,
        ".bak.expand-days",
    )

    CALENDAR.write_text(
        text,
        encoding="utf-8",
    )

    print(
        "Updated ContentCalendar.tsx"
    )


def main() -> None:
    for path in (
        PUBLISHER,
        CALENDAR,
    ):
        if not path.exists():
            print(
                f"File not found: {path}",
                file=sys.stderr,
            )
            sys.exit(1)

    try:
        patch_publisher()
        patch_calendar()
    except Exception as error:
        print(
            f"Patch failed: {error}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("")
    print(
        "History sync and calendar expansion patched."
    )


if __name__ == "__main__":
    main()
