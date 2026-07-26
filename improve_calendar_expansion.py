from pathlib import Path
import shutil
import sys

TSX = Path(
    "apps/web/src/components/calendar/ContentCalendar.tsx"
)

CSS = Path(
    "apps/web/src/components/calendar/ContentCalendar.module.css"
)


def backup(path: Path, suffix: str) -> None:
    target = path.with_suffix(path.suffix + suffix)
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def patch_tsx() -> None:
    text = TSX.read_text(encoding="utf-8")
    original = text

    # Add expanded class to day cell
    old_class = '''                  className={`${styles.dayCell} ${
                    outside
                      ? styles.outside
                      : ""
                  } ${
                    today
                      ? styles.today
                      : ""
'''

    new_class = '''                  className={`${styles.dayCell} ${
                    outside
                      ? styles.outside
                      : ""
                  } ${
                    today
                      ? styles.today
                      : ""
                  } ${
                    expandedDays.has(key)
                      ? styles.expandedDayCell
                      : ""
'''

    if "styles.expandedDayCell" not in text:
        if old_class not in text:
            raise RuntimeError(
                "Could not find dayCell class block."
            )

        text = text.replace(
            old_class,
            new_class,
            1,
        )

    # Add expanded class to dayPosts container
    old_posts = '''                  <div
                    className={styles.dayPosts}
                  >
'''

    new_posts = '''                  <div
                    className={`${styles.dayPosts} ${
                      expandedDays.has(key)
                        ? styles.expandedDayPosts
                        : ""
                    }`}
                  >
'''

    if "styles.expandedDayPosts" not in text:
        if old_posts not in text:
            raise RuntimeError(
                "Could not find dayPosts container."
            )

        text = text.replace(
            old_posts,
            new_posts,
            1,
        )

    # Replace button wording
    old_label = '''                        {expandedDays.has(key)
                          ? "Show less"
                          : `+${dayPosts.length - 3} more`}
'''

    new_label = '''                        {expandedDays.has(key)
                          ? "Show less"
                          : `+${dayPosts.length - 3} more posts`}
'''

    if old_label in text:
        text = text.replace(
            old_label,
            new_label,
            1,
        )

    if text == original:
        print("ContentCalendar.tsx already improved.")
        return

    backup(
        TSX,
        ".bak.calendar-expand-ui",
    )

    TSX.write_text(
        text,
        encoding="utf-8",
    )

    print("Updated ContentCalendar.tsx")


def patch_css() -> None:
    text = CSS.read_text(encoding="utf-8")

    marker = "/* ===== Calendar Expanded Day UI ===== */"

    if marker in text:
        print(
            "ContentCalendar.module.css already improved."
        )
        return

    css = r'''

/* ===== Calendar Expanded Day UI ===== */

.expandedDayCell {
  position: relative;
  z-index: 3;
  min-height: 220px;
  overflow: visible;
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(124, 92, 255, 0.28);
}

.expandedDayPosts {
  max-height: 160px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color:
    rgba(165, 180, 252, 0.45)
    transparent;
}

.expandedDayPosts::-webkit-scrollbar {
  width: 6px;
}

.expandedDayPosts::-webkit-scrollbar-track {
  background: transparent;
}

.expandedDayPosts::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(165, 180, 252, 0.38);
}

.morePostsButton {
  margin-top: 3px;
  border-radius: 7px;
}

.morePostsButton:hover {
  background: rgba(124, 92, 255, 0.08);
}

.monthGrid {
  align-items: start;
}

.dayCell {
  transition:
    min-height 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

@media (max-width: 900px) {
  .expandedDayCell {
    min-height: 190px;
  }

  .expandedDayPosts {
    max-height: 130px;
  }
}
'''

    backup(
        CSS,
        ".bak.calendar-expand-ui",
    )

    CSS.write_text(
        text + css,
        encoding="utf-8",
    )

    print("Updated ContentCalendar.module.css")


def main() -> None:
    for path in (TSX, CSS):
        if not path.exists():
            print(
                f"File not found: {path}",
                file=sys.stderr,
            )
            sys.exit(1)

    try:
        patch_tsx()
        patch_css()
    except Exception as error:
        print(
            f"Patch failed: {error}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("")
    print("Calendar expansion UI completed.")


if __name__ == "__main__":
    main()
