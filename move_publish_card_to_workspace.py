from pathlib import Path
import shutil
import sys


STUDIO = Path("apps/web/src/components/AiStudio.tsx")
WORKSPACE = Path("apps/web/src/components/AiWorkspace.tsx")


def backup(path: Path, suffix: str) -> None:
    backup_path = path.with_suffix(path.suffix + suffix)
    shutil.copy2(path, backup_path)
    print(f"Backup created: {backup_path}")


def patch_studio() -> None:
    text = STUDIO.read_text(encoding="utf-8")
    original = text

    publish_import = (
        'import { AiPublishCard } from "./AiPublishCard";\n'
    )

    publish_block = '''          {result ? (
            <AiPublishCard
              result={result}
              campaignId={campaignId || undefined}
              topic={topic}
              onMessage={setMessage}
            />
          ) : null}
'''

    old_workspace_call = '''        <AiWorkspace
          topic={topic}
          result=  esult}
          campaignId={campaignId || undefined}
          isGenerating={isGenerating}
          statusMessage={message}
          onMessage={setMessage}
\t  onResultChange={setResult}
        />
'''

    new_workspace_call = '''        <AiWorkspace
          topic={topic}
          result={result}
          campaignId={campaignId || undefined}
          publishTopic={topic}
          publishCampaignId={campaignId || undefined}
          isGenerating={isGenerating}
          statusMessage={message}
          onMessage={setMessage}
          onResultChange={setResult}
        />
'''

    if publish_import in text:
        text = text.replace(
            publish_import,
            "",
            1,
        )

    if publish_block in text:
        text = text.replace(
            publish_block,
            "",
            1,
        )
    elif "<AiPublishCard" in text:
        raise RuntimeError(
            "AiPublishCard exists in AiStudio.tsx, "
            "but the expected block format was not found."
        )

    if "publishTopic={topic}" not in text:
        if old_workspace_call in text:
            text = text.replace(
                old_workspace_call,
                new_workspace_call,
                1,
            )
        else:
            marker = '''          campaignId={campaignId || undefined}
          isGenerating={isGenerating}
'''

            replacement = '''          campaignId={campaignId || undefined}
          publishTopic={topic}
          publishCampaignId={campaignId || undefined}
          isGenerating={isGenerating}
'''

            if marker not in text:
                raise RuntimeError(
                    "Could not find AiWorkspace props "
                    "in AiStudio.tsx."
                )

            text = text.replace(
                marker,
                replacement,
                1,
            )

    if text == original:
        print("AiStudio.tsx already patched.")
        return

    backup(
        STUDIO,
        ".bak.move-publish-card",
    )

    STUDIO.write_text(
        text,
        encoding="utf-8",
    )

    print("Updated AiStudio.tsx")


def patch_workspace() -> None:
    text = WORKSPACE.read_text(encoding="utf-8")
    original = text

    import_marker = (
        'import { AtlasCopilot } from "./AtlasCopilot";\n'
    )

    publish_import = (
        'import { AiPublishCard } from "./AiPublishCard";\n'
    )

    if publish_import not in text:
        if import_marker not in text:
            raise RuntimeError(
                "Could not find import marker "
                "in AiWorkspace.tsx."
            )

        text = text.replace(
            import_marker,
            import_marker + publish_import,
            1,
        )

    destructure_marker = '''  campaignId,
  isGenerating,
'''

    destructure_replacement = '''  campaignId,
  publishTopic,
  publishCampaignId,
  isGenerating,
'''

    if "publishTopic," not in text:
        if destructure_marker not in text:
            raise RuntimeError(
                "Could not find AiWorkspace "
                "destructuring marker."
            )

        text = text.replace(
            destructure_marker,
            destructure_replacement,
            1,
        )

    props_marker = '''  campaignId?: string;
  isGenerating: boolean;
'''

    props_replacement = '''  campaignId?: string;
  publishTopic: string;
  publishCampaignId?: string;
  isGenerating: boolean;
'''

    if "publishTopic: string;" not in text:
        if props_marker not in text:
            raise RuntimeError(
                "Could not find AiWorkspace "
                "props type marker."
            )

        text = text.replace(
            props_marker,
            props_replacement,
            1,
        )

    render_marker = '''      {tab === "prompt" ? (
        <PromptInspector
          promptChain={result?.promptChain}
          onMessage={onMessage}
        />
      ) : null}
'''

    publish_render = '''      {tab === "prompt" ? (
        <PromptInspector
          promptChain={result?.promptChain}
          onMessage={onMessage}
        />
      ) : null}

      {result ? (
        <AiPublishCard
          result={result}
          campaignId={publishCampaignId}
          topic={publishTopic}
          onMessage={onMessage}
        />
      ) : null}
'''

    if "<AiPublishCard" not in text:
        if render_marker not in text:
            raise RuntimeError(
                "Could not find PromptInspector "
                "render block."
            )

        text = text.replace(
            render_marker,
            publish_render,
            1,
        )

    if text == original:
        print("AiWorkspace.tsx already patched.")
        return

    backup(
        WORKSPACE,
        ".bak.move-publish-card",
    )

    WORKSPACE.write_text(
        text,
        encoding="utf-8",
    )

    print("Updated AiWorkspace.tsx")


def main() -> None:
    for path in (STUDIO, WORKSPACE):
        if not path.exists():
            print(
                f"File not found: {path}",
                file=sys.stderr,
            )
            sys.exit(1)

    try:
        patch_studio()
        patch_workspace()
    except Exception as error:
        print(
            f"Patch failed: {error}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("")
    print("Publish Card moved into AI Workspace.")
    print("Next: npm run build --workspace apps/web")


if __name__ == "__main__":
    main()
