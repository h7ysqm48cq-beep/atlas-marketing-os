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

    old_link = '''                {post.externalPostUrl ? (
                  <a
                    href={post.externalPostUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open post
                  </a>
                ) : null}
'''

    new_link = '''                {post.externalPostUrl ? (
                  <a
                    href={post.externalPostUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open post
                  </a>
                ) : post.platform === "TELEGRAM" &&
                  post.channel.username &&
                  post.externalPostId ? (
                  <a
                    href={`https://t.me/${post.channel.username}/${post.externalPostId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open message
                  </a>
                ) : (
                  <span className={styles.noExternalLink}>
                    No external link
                  </span>
                )}
'''

    if "Open message" not in text:
        if old_link not in text:
            raise RuntimeError(
                "Could not find published post link block."
            )

        text = text.replace(
            old_link,
            new_link,
            1,
        )

    old_platform = '''                  <span className={styles.publishPlatform}>
                    {post.platform === "FACEBOOK"
                      ? "Facebook"
                      : "Telegram"}
                  </span>
'''

    new_platform = '''                  <span className={styles.publishPlatform}>
                    <span
                      className={`${styles.publishPlatformIcon} ${
                        post.platform === "FACEBOOK"
                          ? styles.facebookPublishIcon
                          : styles.telegramPublishIcon
                      }`}
                    >
                      {post.platform === "FACEBOOK" ? "f" : "✈"}
                    </span>

                    {post.platform === "FACEBOOK"
                      ? "Facebook"
                      : "Telegram"}
                  </span>
'''

    if "publishPlatformIcon" not in text:
        if old_platform not in text:
            raise RuntimeError(
                "Could not find platform label block."
            )

        text = text.replace(
            old_platform,
            new_platform,
            1,
        )

    if text == original:
        print("ContentHistory.tsx already patched.")
        return

    backup(TSX, ".bak.telegram-link")
    TSX.write_text(text, encoding="utf-8")
    print("Updated ContentHistory.tsx")


def patch_css() -> None:
    text = CSS.read_text(encoding="utf-8")

    marker = "/* ===== Published Platform Links ===== */"

    if marker in text:
        print("ContentHistory.module.css already patched.")
        return

    css = r'''

/* ===== Published Platform Links ===== */

.publishPlatform {
  display: flex;
  align-items: center;
  gap: 7px;
}

.publishPlatformIcon {
  display: inline-grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 7px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 900;
}

.facebookPublishIcon {
  background: #2563eb;
}

.telegramPublishIcon {
  background: #0ea5e9;
}

.noExternalLink {
  color: var(--muted);
  font-size: 8px;
}
'''

    backup(CSS, ".bak.telegram-link")
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
    print("Telegram history link added.")


if __name__ == "__main__":
    main()
