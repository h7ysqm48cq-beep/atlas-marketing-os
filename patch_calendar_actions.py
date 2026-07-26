from pathlib import Path
import shutil
import sys

FILE = Path("apps/web/src/components/calendar/ContentCalendar.tsx")

OLD = '''              <div
                className={styles.primaryActions}
              >
                <button
                  className={
                    styles.cancelPostButton
                  }
                  onClick={() =>
                    void postAction("cancel")
                  }
                disabled={
                  saving ||
                  selectedPost.status ===
                    "PUBLISHED" ||
                  selectedPost.status ===
                    "CANCELLED"
                }
              >
                Cancel post
              </button>

              <button
                className={styles.primaryButton}
                onClick={() =>
                  void postAction("queue")
                }
                disabled={
                  saving ||
                  ![
                    "DRAFT",
                    "SCHEDULED",
                    "FAILED",
                  ].includes(
                    selectedPost.status,
                  )
                }
              >
                Add to queue
              </button>
              </div>'''

NEW = '''              <div
                className={styles.primaryActions}
              >
                {selectedPost.status ===
                  "PUBLISHED" &&
                selectedPost.externalPostId ? (
                  <a
                    className={styles.primaryButton}
                    href={`https://www.facebook.com/${selectedPost.externalPostId.replace(
                      "_",
                      "/posts/",
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open on Facebook
                  </a>
                ) : (
                  <>
                    {selectedPost.status !==
                      "CANCELLED" ? (
                      <button
                        type="button"
                        className={
                          styles.cancelPostButton
                        }
                        onClick={() =>
                          void postAction(
                            "cancel",
                          )
                        }
                        disabled={
                          saving ||
                          selectedPost.status ===
                            "DRAFT"
                        }
                      >
                        Cancel post
                      </button>
                    ) : null}

                    {[
                      "DRAFT",
                      "SCHEDULED",
                      "FAILED",
                    ].includes(
                      selectedPost.status,
                    ) ? (
                      <button
                        type="button"
                        className={
                          styles.primaryButton
                        }
                        onClick={() =>
                          void postAction(
                            "queue",
                          )
                        }
                        disabled={saving}
                      >
                        Add to queue
                      </button>
                    ) : null}
                  </>
                )}
              </div>'''

def main() -> None:
    if not FILE.exists():
        print(f"File not found: {FILE}", file=sys.stderr)
        sys.exit(1)

    text = FILE.read_text(encoding="utf-8")

    if "Open on Facebook" in text:
        print("Patch already applied. Nothing changed.")
        return

    if OLD not in text:
        print(
            "Target block not found. No files changed.",
            file=sys.stderr,
        )
        sys.exit(1)

    backup = FILE.with_suffix(FILE.suffix + ".bak")
    shutil.copy2(FILE, backup)

    FILE.write_text(
        text.replace(OLD, NEW, 1),
        encoding="utf-8",
    )

    print(f"Backup created: {backup}")
    print(f"Updated: {FILE}")

if __name__ == "__main__":
    main()
