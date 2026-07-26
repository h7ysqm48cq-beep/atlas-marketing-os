from pathlib import Path
import shutil
import sys

TSX = Path("apps/web/src/components/AiStudio.tsx")
CSS = Path("apps/web/src/components/AiStudio.module.css")


def backup(path: Path, suffix: str) -> None:
    target = path.with_suffix(path.suffix + suffix)
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def patch_tsx() -> None:
    text = TSX.read_text(encoding="utf-8")
    original = text

    api_marker = '''const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
'''

    platform_types = '''const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const platformOptions = [
  "Facebook",
  "Telegram",
  "Reels",
  "Image Prompt",
] as const;

type StudioPlatform =
  (typeof platformOptions)[number];
'''

    if "const platformOptions =" not in text:
        if api_marker not in text:
            raise RuntimeError(
                "Could not find API_BASE_URL block."
            )

        text = text.replace(
            api_marker,
            platform_types,
            1,
        )

    old_state = '''  const [platforms] = useState([
    "Facebook",
    "Telegram",
    "Reels",
    "Image Prompt",
  ]);
'''

    new_state = '''  const [platforms, setPlatforms] =
    useState<StudioPlatform[]>([
      ...platformOptions,
    ]);
'''

    if old_state in text:
        text = text.replace(
            old_state,
            new_state,
            1,
        )
    elif "setPlatforms" not in text:
        raise RuntimeError(
            "Could not find platforms state."
        )

    generate_marker = '''  async function generateContent() {
'''

    toggle_method = '''  function togglePlatform(
    platform: StudioPlatform,
  ) {
    setPlatforms((current) => {
      if (current.includes(platform)) {
        if (current.length === 1) {
          setMessage(
            "Select at least one platform.",
          );

          return current;
        }

        return current.filter(
          (item) => item !== platform,
        );
      }

      return [...current, platform];
    });
  }

  async function generateContent() {
'''

    if "function togglePlatform(" not in text:
        if generate_marker not in text:
            raise RuntimeError(
                "Could not find generateContent()."
            )

        text = text.replace(
            generate_marker,
            toggle_method,
            1,
        )

    topic_validation = '''    if (!topic.trim()) {
      setMessage("Topic is required.");
      return;
    }
'''

    validation_replacement = '''    if (!topic.trim()) {
      setMessage("Topic is required.");
      return;
    }

    if (!platforms.length) {
      setMessage(
        "Select at least one platform.",
      );
      return;
    }
'''

    if (
        'if (!platforms.length)' not in text
        and topic_validation in text
    ):
        text = text.replace(
            topic_validation,
            validation_replacement,
            1,
        )

    old_buttons = '''              {platforms.map((platform) => (
                <button type="button" key={platform}>
                  ✓ {platform}
                </button>
              ))}
'''

    new_buttons = '''              {platformOptions.map(
                (platform) => {
                  const selected =
                    platforms.includes(platform);

                  return (
                    <button
                      type="button"
                      key={platform}
                      aria-pressed={selected}
                      className={
                        selected
                          ? styles.activePlatform
                          : styles.inactivePlatform
                      }
                      onClick={() =>
                        togglePlatform(platform)
                      }
                    >
                      <span>
                        {selected ? "✓" : "+"}
                      </span>
                      {platform}
                    </button>
                  );
                },
              )}
'''

    if old_buttons in text:
        text = text.replace(
            old_buttons,
            new_buttons,
            1,
        )
    elif "togglePlatform(platform)" not in text:
        raise RuntimeError(
            "Could not find platform button block."
        )

    if text == original:
        print("AiStudio.tsx already patched.")
        return

    backup(TSX, ".bak.platform-toggle")
    TSX.write_text(text, encoding="utf-8")
    print("Updated AiStudio.tsx")


def patch_css() -> None:
    text = CSS.read_text(encoding="utf-8")

    marker = "/* ===== Selectable AI Studio Platforms ===== */"

    if marker in text:
        print("AiStudio.module.css already patched.")
        return

    css = r'''

/* ===== Selectable AI Studio Platforms ===== */

.platforms button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.platforms button:hover {
  transform: translateY(-1px);
}

.platforms button span {
  display: inline-grid;
  width: 17px;
  height: 17px;
  place-items: center;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 900;
}

.activePlatform {
  border-color: rgba(209, 163, 63, 0.62) !important;
  background: rgba(209, 163, 63, 0.12) !important;
  color: #f8d56b !important;
}

.activePlatform span {
  background: rgba(209, 163, 63, 0.18);
  color: #f8d56b;
}

.inactivePlatform {
  border-color: rgba(148, 163, 184, 0.2) !important;
  background: rgba(15, 23, 42, 0.48) !important;
  color: #94a3b8 !important;
}

.inactivePlatform span {
  background: rgba(148, 163, 184, 0.1);
  color: #94a3b8;
}

.platforms button:focus-visible {
  outline: 2px solid rgba(209, 163, 63, 0.7);
  outline-offset: 3px;
}
'''

    backup(CSS, ".bak.platform-toggle")
    CSS.write_text(
        text + css,
        encoding="utf-8",
    )
    print("Updated AiStudio.module.css")


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
        "AI Studio platform selection enabled."
    )


if __name__ == "__main__":
    main()
