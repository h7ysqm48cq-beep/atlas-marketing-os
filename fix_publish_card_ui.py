from pathlib import Path
import shutil

ROOT = Path("apps/web/src/components")

publish_css = ROOT / "AiPublishCard.module.css"
studio_css = ROOT / "AiStudio.module.css"


def append_if_missing(path: Path, snippet: str, marker: str):
    text = path.read_text(encoding="utf-8")

    if marker in text:
        print(f"{path.name}: already patched")
        return

    backup = path.with_suffix(path.suffix + ".bak.ui")
    shutil.copy2(path, backup)

    text += "\n\n/* ===== Sprint 1 UI Polish ===== */\n"
    text += snippet

    path.write_text(text, encoding="utf-8")

    print(f"Updated {path.name}")
    print(f"Backup : {backup.name}")


publish_patch = r"""

.card{
    gap:12px;
    padding:16px;
    margin-top:14px;
}

.heading h3{
    font-size:16px;
    line-height:1.2;
}

.platforms{
    gap:8px;
}

.platforms label{
    padding:10px;
    border-radius:10px;
}

.mode{
    gap:6px;
}

.mode button{
    padding:8px;
    font-size:13px;
}

.scheduleField{
    gap:6px;
}

.scheduleField input{
    padding:9px 10px;
    font-size:14px;
}

.publishButton{
    position:sticky;
    bottom:12px;
    z-index:20;

    padding:12px;

    border-radius:10px;
}

.success{
    max-height:180px;
    overflow-y:auto;
}

.success div{
    padding:4px 0;
}

"""

studio_patch = r"""

.formCard{
    align-self:start;
    max-height:calc(100vh - 100px);
    overflow-y:auto;
}

"""

append_if_missing(
    publish_css,
    publish_patch,
    "position:sticky",
)

append_if_missing(
    studio_css,
    studio_patch,
    "max-height:calc(100vh - 100px)",
)

print("\nDone.")
