from pathlib import Path
import shutil
import sys

TSX = Path(
    "apps/web/src/components/ContentHistory.tsx"
)

CSS = Path(
    "apps/web/src/components/ContentHistory.module.css"
)


def backup(path: Path, suffix: str) -> None:
    target = path.with_suffix(path.suffix + suffix)
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def patch_tsx() -> None:
    text = TSX.read_text(encoding="utf-8")
    original = text

    # Add ScheduledPost fields used by the publishing result UI.
    old_type = '''    status: string;
    publishedAt?: string | null;
    externalPostId?: string | null;
    externalPostUrl?: string | null;
'''

    new_type = '''    status: string;
    scheduledAt?: string;
    publishedAt?: string | null;
    externalPostId?: string | null;
    externalPostUrl?: string | null;
    lastError?: string | null;
    retryCount?: number;
'''

    if "lastError?: string | null;" not in text:
        if old_type not in text:
            raise RuntimeError(
                "Could not find scheduledPosts type block."
            )

        text = text.replace(
            old_type,
            new_type,
            1,
        )

    # Replace the simple status badge with a status-aware badge.
    old_status = '''                <span
                  className={
                    styles.publishStatus
                  }
                >
                  {formatPublishStatus(post.status)}
                </span>
'''

    new_status = '''                <span
                  className={`${styles.publishStatus} ${
                    post.status === "PUBLISHED"
                      ? styles.publishStatusSuccess
                      : post.status === "FAILED"
                        ? styles.publishStatusFailed
                        : styles.publishStatusPending
                  }`}
                >
                  {formatPublishStatus(post.status)}
                </span>
'''

    if "publishStatusSuccess" not in text:
        if old_status not in text:
            raise RuntimeError(
                "Could not find publish status badge."
            )

        text = text.replace(
            old_status,
            new_status,
            1,
        )

    # Add error and retry information below the platform details.
    detail_marker = '''                  {post.platform === "TELEGRAM" &&
                  post.externalPostId ? (
                    <small>
                      Message ID: {post.externalPostId}
                    </small>
                  ) : null}
'''

    detail_replacement = '''                  {post.platform === "TELEGRAM" &&
                  post.externalPostId ? (
                    <small>
                      Message ID: {post.externalPostId}
                    </small>
                  ) : null}

                  {post.status === "FAILED" &&
                  post.lastError ? (
                    <small className={styles.publishError}>
                      {post.lastError}
                    </small>
                  ) : null}

                  {typeof post.retryCount === "number" &&
                  post.retryCount > 0 ? (
                    <small>
                      Attempts: {post.retryCount}
                    </small>
                  ) : null}
'''

    if "className={styles.publishError}" not in text:
        if detail_marker not in text:
            raise RuntimeError(
                "Could not find published platform detail block."
            )

        text = text.replace(
            detail_marker,
            detail_replacement,
            1,
        )

    # Add a Calendar link when the post cannot be opened externally.
    old_fallback = '''                ) : (
                  <span className={styles.noExternalLink}>
                    No external link
                  </span>
                )}
'''

    new_fallback = '''                ) : (
                  <a
                    href="/calendar"
                    className={styles.calendarFallbackLink}
                  >
                    {post.status === "FAILED"
                      ? "Review failure"
                      : "Open calendar"}
                  </a>
                )}
'''

    if "calendarFallbackLink" not in text:
        if old_fallback not in text:
            raise RuntimeError(
                "Could not find external-link fallback."
            )

        text = text.replace(
            old_fallback,
            new_fallback,
            1,
        )

    if text == original:
        print("ContentHistory.tsx already improved.")
        return

    backup(
        TSX,
        ".bak.publish-result-ui",
    )

    TSX.write_text(
        text,
        encoding="utf-8",
    )

    print("Updated ContentHistory.tsx")


def patch_css() -> None:
    text = CSS.read_text(encoding="utf-8")

    marker = "/* ===== Publish Result States ===== */"

    if marker in text:
        print(
            "ContentHistory.module.css already improved."
        )
        return

    css = r'''

/* ===== Publish Result States ===== */

.publishStatusSuccess {
  background: rgba(77, 190, 134, 0.1);
  color: #8fe0b5;
}

.publishStatusFailed {
  background: rgba(255, 120, 120, 0.1);
  color: #ffaaaa;
}

.publishStatusPending {
  background: rgba(209, 163, 63, 0.1);
  color: var(--gold-light);
}

.publishError {
  color: #ffaaaa !important;
  line-height: 1.45;
}

.calendarFallbackLink {
  display: grid;
  min-height: 34px;
  padding: 0 11px;
  place-items: center;
  border: 1px solid rgba(209, 163, 63, 0.3);
  border-radius: 8px;
  background: rgba(209, 163, 63, 0.07);
  color: var(--gold-light);
  font-size: 8px;
  font-weight: 800;
  text-decoration: none;
}

.calendarFallbackLink:hover {
  background: rgba(209, 163, 63, 0.13);
}
'''

    backup(
        CSS,
        ".bak.publish-result-ui",
    )

    CSS.write_text(
        text + css,
        encoding="utf-8",
    )

    print(
        "Updated ContentHistory.module.css"
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
        "History publishing-result UI completed."
    )


if __name__ == "__main__":
    main()
