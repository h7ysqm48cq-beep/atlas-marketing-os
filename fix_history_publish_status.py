from pathlib import Path
import shutil
import sys

path = Path(
    "apps/web/src/components/ContentHistory.tsx"
)

if not path.exists():
    print(f"File not found: {path}")
    sys.exit(1)

text = path.read_text(encoding="utf-8")
original = text

# --------------------------------------------------
# Add formatter
# --------------------------------------------------

marker = '''
function formatStatus(status:ContentStatus){ return status.toLowerCase().split("_").map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(" "); }
'''

replacement = '''
function formatStatus(status:ContentStatus){ return status.toLowerCase().split("_").map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(" "); }

function formatPublishStatus(status:string){
  return status
    .toLowerCase()
    .split("_")
    .map(
      (part)=>
        part.charAt(0).toUpperCase()+
        part.slice(1),
    )
    .join(" ");
}
'''

if "function formatPublishStatus" not in text:
    if marker not in text:
        print("Could not find formatStatus().")
        sys.exit(1)

    text = text.replace(
        marker,
        replacement,
        1,
    )

# --------------------------------------------------
# Replace usages
# --------------------------------------------------

text = text.replace(
    "formatStatus(post.status)",
    "formatPublishStatus(post.status)",
)

text = text.replace(
    "formatStatus(\n                    post.status as ContentStatus,\n                  )",
    "formatPublishStatus(post.status)",
)

if text == original:
    print("Nothing changed.")
    sys.exit(0)

backup = path.with_suffix(
    ".tsx.bak.publish-status"
)

shutil.copy2(path, backup)

path.write_text(
    text,
    encoding="utf-8",
)

print(f"Backup created: {backup}")
print("Publish status formatter fixed.")
