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

    # Remove old expanded-day state if present.
    old_state = '''  const [expandedDays, setExpandedDays] =
    useState<Set<string>>(
      () => new Set(),
    );

'''

    if old_state in text:
        text = text.replace(old_state, "", 1)

    # Add day popover state.
    state_marker = '''  const [hoveredPostId, setHoveredPostId] =
'''

    state_code = '''  const [dayPopover, setDayPopover] =
    useState<{
      key: string;
      date: Date;
      posts: ScheduledPost[];
    } | null>(null);

  const [hoveredPostId, setHoveredPostId] =
'''

    if "const [dayPopover" not in text:
        if state_marker not in text:
            raise RuntimeError(
                "Could not find calendar state marker."
            )

        text = text.replace(
            state_marker,
            state_code,
            1,
        )

    # Remove expanded cell class.
    text = text.replace(
        '''                  } ${
                    expandedDays.has(key)
                      ? styles.expandedDayCell
                      : ""
''',
        "",
        1,
    )

    # Restore normal dayPosts class.
    old_posts_class = '''                  <div
                    className={`${styles.dayPosts} ${
                      expandedDays.has(key)
                        ? styles.expandedDayPosts
                        : ""
                    }`}
                  >
'''

    new_posts_class = '''                  <div
                    className={styles.dayPosts}
                  >
'''

    if old_posts_class in text:
        text = text.replace(
            old_posts_class,
            new_posts_class,
            1,
        )

    # Restore first 3 posts only.
    old_posts_map = '''                    {(expandedDays.has(key)
                      ? dayPosts
                      : dayPosts.slice(0, 3)
                    ).map((post) => (
'''

    new_posts_map = '''                    {dayPosts
                      .slice(0, 3)
                      .map((post) => (
'''

    if old_posts_map in text:
        text = text.replace(
            old_posts_map,
            new_posts_map,
            1,
        )

    # Replace +more toggle with popover opener.
    start_marker = '''                    {dayPosts.length > 3 ? (
                      <span
                        role="button"
'''

    start = text.find(start_marker)

    if start == -1:
        if "setDayPopover" not in text:
            raise RuntimeError(
                "Could not find more-posts control."
            )
    else:
        end_marker = '''                    ) : null}
'''
        end = text.find(end_marker, start)

        if end == -1:
            raise RuntimeError(
                "Could not find end of more-posts control."
            )

        end += len(end_marker)

        new_more = '''                    {dayPosts.length > 3 ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className={
                          styles.morePostsButton
                        }
                        onClick={(event) => {
                          event.stopPropagation();

                          setDayPopover({
                            key,
                            date,
                            posts: dayPosts,
                          });
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "Enter" &&
                            event.key !== " "
                          ) {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();

                          setDayPopover({
                            key,
                            date,
                            posts: dayPosts,
                          });
                        }}
                      >
                        +{dayPosts.length - 3} more posts
                      </span>
                    ) : null}
'''

        text = text[:start] + new_more + text[end:]

    # Insert popover before create modal.
    popover_marker = '''      {showCreate ? (
'''

    popover_code = '''      {dayPopover ? (
        <div
          className={styles.dayPopoverBackdrop}
          onClick={() => setDayPopover(null)}
        >
          <section
            className={styles.dayPopover}
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <header>
              <div>
                <p className={styles.eyebrow}>
                  Daily schedule
                </p>

                <h2>
                  {new Intl.DateTimeFormat(
                    "en-MY",
                    {
                      dateStyle: "full",
                    },
                  ).format(dayPopover.date)}
                </h2>

                <span>
                  {dayPopover.posts.length} posts
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  setDayPopover(null)
                }
              >
                ×
              </button>
            </header>

            <div className={styles.dayPopoverList}>
              {dayPopover.posts.map((post) => (
                <button
                  type="button"
                  key={post.id}
                  className={
                    styles.dayPopoverPost
                  }
                  onClick={() => {
                    setSelectedPost(post);
                    setDayPopover(null);
                  }}
                >
                  <span
                    className={`${styles.platformDot} ${
                      post.platform ===
                      "FACEBOOK"
                        ? styles.facebook
                        : styles.telegram
                    }`}
                  />

                  <div>
                    <strong>
                      {post.title ||
                        post.content.slice(
                          0,
                          70,
                        )}
                    </strong>

                    <small>
                      {post.platform ===
                      "FACEBOOK"
                        ? "Facebook"
                        : "Telegram"}
                      {" · "}
                      {timeOnly(
                        post.scheduledAt,
                      )}
                    </small>

                    <small>
                      {post.channel.name}
                    </small>
                  </div>

                  <b>
                    {statusLabel(post.status)}
                  </b>
                </button>
              ))}
            </div>

            <footer>
              <button
                type="button"
                onClick={() => {
                  openCreate(
                    dayPopover.date,
                  );
                  setDayPopover(null);
                }}
              >
                Create post
              </button>

              <button
                type="button"
                onClick={() =>
                  setDayPopover(null)
                }
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {showCreate ? (
'''

    if "className={styles.dayPopoverBackdrop}" not in text:
        if popover_marker not in text:
            raise RuntimeError(
                "Could not find create modal marker."
            )

        text = text.replace(
            popover_marker,
            popover_code,
            1,
        )

    if text == original:
        print(
            "ContentCalendar.tsx already patched."
        )
        return

    backup(
        TSX,
        ".bak.day-popover",
    )

    TSX.write_text(
        text,
        encoding="utf-8",
    )

    print("Updated ContentCalendar.tsx")


def patch_css() -> None:
    text = CSS.read_text(encoding="utf-8")

    marker = "/* ===== Calendar Day Popover ===== */"

    if marker in text:
        print(
            "ContentCalendar.module.css already patched."
        )
        return

    css = r'''

/* ===== Calendar Day Popover ===== */

.dayPopoverBackdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(3, 6, 12, 0.72);
  backdrop-filter: blur(7px);
}

.dayPopover {
  display: grid;
  width: min(620px, 100%);
  max-height: min(720px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid rgba(124, 92, 255, 0.3);
  border-radius: 18px;
  background: #0d1420;
  box-shadow:
    0 28px 80px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(124, 92, 255, 0.08);
}

.dayPopover > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px;
  border-bottom: 1px solid var(--border);
}

.dayPopover > header > div {
  display: grid;
  gap: 5px;
}

.dayPopover h2 {
  margin: 0;
  color: var(--text);
  font-size: 19px;
}

.dayPopover header span {
  color: var(--muted);
  font-size: 11px;
}

.dayPopover > header > button {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 20px;
  cursor: pointer;
}

.dayPopoverList {
  display: grid;
  gap: 9px;
  padding: 18px 20px;
  overflow-y: auto;
}

.dayPopoverPost {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(8, 12, 20, 0.7);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.dayPopoverPost:hover {
  border-color: rgba(124, 92, 255, 0.45);
  background: rgba(79, 70, 229, 0.08);
}

.dayPopoverPost > div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.dayPopoverPost strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.dayPopoverPost small {
  color: var(--muted);
  font-size: 9px;
}

.dayPopoverPost b {
  color: #c4b5fd;
  font-size: 9px;
  text-transform: uppercase;
}

.dayPopover > footer {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
}

.dayPopover > footer button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: transparent;
  color: var(--text);
  font-weight: 750;
  cursor: pointer;
}

.dayPopover > footer button:first-child {
  border-color: rgba(124, 92, 255, 0.42);
  background: rgba(79, 70, 229, 0.13);
  color: #c4b5fd;
}

@media (max-width: 640px) {
  .dayPopoverBackdrop {
    align-items: end;
    padding: 0;
  }

  .dayPopover {
    width: 100%;
    max-height: 88vh;
    border-radius: 18px 18px 0 0;
  }

  .dayPopoverPost {
    grid-template-columns:
      auto minmax(0, 1fr);
  }

  .dayPopoverPost b {
    grid-column: 2;
  }
}
'''

    backup(
        CSS,
        ".bak.day-popover",
    )

    CSS.write_text(
        text + css,
        encoding="utf-8",
    )

    print(
        "Updated ContentCalendar.module.css"
    )


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
    print(
        "Calendar day popover completed."
    )


if __name__ == "__main__":
    main()
