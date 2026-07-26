from pathlib import Path
import shutil
import sys

TSX = Path("apps/web/src/components/ContentHistory.tsx")
CSS = Path("apps/web/src/components/ContentHistory.module.css")


def backup(path: Path, suffix: str) -> None:
    target = path.with_suffix(path.suffix + suffix)
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def patch_tsx() -> None:
    text = TSX.read_text(encoding="utf-8")
    original = text

    old_type = '''  campaign: { id: string; name: string } | null;
  idea: { id: string; title: string; sortOrder: number } | null;
};
'''

    new_type = '''  campaign: { id: string; name: string } | null;
  idea: { id: string; title: string; sortOrder: number } | null;
  scheduledPosts?: Array<{
    id: string;
    platform: "FACEBOOK" | "TELEGRAM";
    status: string;
    publishedAt?: string | null;
    externalPostId?: string | null;
    externalPostUrl?: string | null;
    channel: {
      id: string;
      name: string;
      username?: string | null;
      externalId?: string | null;
    };
  }>;
};
'''

    if "scheduledPosts?: Array<{" not in text:
        if old_type not in text:
            raise RuntimeError("HistoryRecord type marker not found.")

        text = text.replace(old_type, new_type, 1)

    marker = '''        <div className={styles.publishedActions}>
'''

    publish_list = '''        {selected.scheduledPosts?.length ? (
          <div className={styles.publishedPostList}>
            {selected.scheduledPosts.map((post) => (
              <article key={post.id}>
                <div>
                  <span className={styles.publishPlatform}>
                    {post.platform === "FACEBOOK"
                      ? "Facebook"
                      : "Telegram"}
                  </span>

                  <strong>{post.channel.name}</strong>

                  <small>
                    {post.publishedAt
                      ? formatDate(post.publishedAt)
                      : formatStatus(post.status)}
                  </small>

                  {post.platform === "TELEGRAM" &&
                  post.externalPostId ? (
                    <small>
                      Message ID: {post.externalPostId}
                    </small>
                  ) : null}
                </div>

                <span
                  className={
                    styles.publishStatus
                  }
                >
                  {formatStatus(
                    post.status as ContentStatus,
                  )}
                </span>

                {post.externalPostUrl ? (
                  <a
                    href={post.externalPostUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open post
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.noPublishRecords}>
            No linked publishing records found.
          </p>
        )}

        <div className={styles.publishedActions}>
'''

    if "publishedPostList" not in text:
        if marker not in text:
            raise RuntimeError("Published actions marker not found.")

        text = text.replace(marker, publish_list, 1)

    if text == original:
        print("ContentHistory.tsx already patched.")
        return

    backup(TSX, ".bak.publish-records")
    TSX.write_text(text, encoding="utf-8")
    print("Updated ContentHistory.tsx")


def patch_css() -> None:
    text = CSS.read_text(encoding="utf-8")

    marker = "/* ===== Published Post Records ===== */"

    if marker in text:
        print("ContentHistory.module.css already patched.")
        return

    css = r'''

/* ===== Published Post Records ===== */

.publishedPostList {
  display: grid;
  gap: 9px;
}

.publishedPostList article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(7, 9, 13, 0.42);
}

.publishedPostList article > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.publishPlatform {
  color: var(--gold-light);
  font-size: 8px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.publishedPostList strong {
  font-size: 11px;
  color: var(--text);
}

.publishedPostList small {
  color: var(--muted);
  font-size: 8px;
}

.publishStatus {
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(77, 190, 134, 0.1);
  color: #8fe0b5;
  font-size: 8px;
  font-weight: 850;
}

.publishedPostList a {
  display: grid;
  min-height: 34px;
  padding: 0 11px;
  place-items: center;
  border: 1px solid rgba(124, 92, 255, 0.32);
  border-radius: 8px;
  background: rgba(79, 70, 229, 0.09);
  color: #c4b5fd;
  font-size: 8px;
  font-weight: 800;
  text-decoration: none;
}

.noPublishRecords {
  margin: 0;
  color: var(--muted);
  font-size: 9px;
}

@media (max-width: 680px) {
  .publishedPostList article {
    grid-template-columns: 1fr;
  }
}
'''

    backup(CSS, ".bak.publish-records")
    CSS.write_text(text + css, encoding="utf-8")
    print("Updated ContentHistory.module.css")


def main() -> None:
    for path in (TSX, CSS):
        if not path.exists():
            print(f"File not found: {path}", file=sys.stderr)
            sys.exit(1)

    try:
        patch_tsx()
        patch_css()
    except Exception as error:
        print(f"Patch failed: {error}", file=sys.stderr)
        sys.exit(1)

    print("")
    print("Published platform records added to History UI.")


if __name__ == "__main__":
    main()
