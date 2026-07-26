from pathlib import Path
import shutil
import sys

path = Path(
    "apps/web/src/components/calendar/ContentCalendar.tsx"
)

text = path.read_text(encoding="utf-8")

old = '''                    {dayPosts.length > 3 ? (
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
                          : `+${dayPosts.length - 3} more posts`}
                      </button>
                    ) : null}
'''

new = '''                    {dayPosts.length > 3 ? (
                      <span
                        role="button"
                        tabIndex={0}
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
                        onKeyDown={(event) => {
                          if (
                            event.key !== "Enter" &&
                            event.key !== " "
                          ) {
                            return;
                          }

                          event.preventDefault();
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
                          : `+${dayPosts.length - 3} more posts`}
                      </span>
                    ) : null}
'''

if old not in text:
    print(
        "Could not find nested more-posts button block.",
        file=sys.stderr,
    )
    sys.exit(1)

backup = path.with_suffix(
    ".tsx.bak.nested-button-fix"
)

shutil.copy2(path, backup)

path.write_text(
    text.replace(old, new, 1),
    encoding="utf-8",
)

print(f"Backup created: {backup}")
print("Nested calendar button fixed.")
