from pathlib import Path
import shutil
import sys


ROOT = Path.home() / "Downloads" / "atlas-marketing-os"

SERVICE_FILE = (
    ROOT
    / "apps"
    / "api"
    / "src"
    / "automation"
    / "automation.service.ts"
)

CONTROLLER_FILE = (
    ROOT
    / "apps"
    / "api"
    / "src"
    / "automation"
    / "automation.controller.ts"
)


SERVICE_METHOD = """
  async updateChannel(
    id: string,
    input: {
      name?: string;
      externalId?: string;
      username?: string | null;
    },
  ) {
    await this.ensureChannel(id);

    return this.prisma.socialChannel.update({
      where: {
        id,
      },
      data: {
        name:
          input.name !== undefined
            ? input.name.trim()
            : undefined,
        externalId:
          input.externalId !== undefined
            ? input.externalId.trim() || null
            : undefined,
        username:
          input.username !== undefined
            ? input.username?.trim() || null
            : undefined,
      },
    });
  }

"""


CONTROLLER_METHOD = """
  @Patch('channels/:id')
  updateChannel(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      externalId?: string;
      username?: string | null;
    },
  ) {
    return this.automationService.updateChannel(
      id,
      body,
    );
  }

"""


def backup_file(path: Path) -> None:
    backup = path.with_suffix(path.suffix + ".bak")
    shutil.copy2(path, backup)
    print(f"Backup created: {backup}")


def patch_service() -> None:
    text = SERVICE_FILE.read_text(encoding="utf-8")

    if "async updateChannel(" in text:
        print("Service updateChannel() already exists. Skipped.")
        return

    marker = "  async updateChannelStatus("

    if marker not in text:
        raise RuntimeError(
            "Could not find updateChannelStatus() in 
automation.service.ts"
        )

    backup_file(SERVICE_FILE)

    text = text.replace(
        marker,
        SERVICE_METHOD + marker,
        1,
    )

    SERVICE_FILE.write_text(text, encoding="utf-8")
    print("Updated automation.service.ts")


def patch_controller() -> None:
    text = CONTROLLER_FILE.read_text(encoding="utf-8")

    if "@Patch('channels/:id')" in text:
        print("Controller channel PATCH endpoint already exists. 
Skipped.")
        return

    marker = "  @Patch('channels/:id/status')"

    if marker not in text:
        raise RuntimeError(
            "Could not find channels/:id/status endpoint "
            "in automation.controller.ts"
        )

    backup_file(CONTROLLER_FILE)

    text = text.replace(
        marker,
        CONTROLLER_METHOD + marker,
        1,
    )

    CONTROLLER_FILE.write_text(text, encoding="utf-8")
    print("Updated automation.controller.ts")


def main() -> None:
    for path in (SERVICE_FILE, CONTROLLER_FILE):
        if not path.exists():
            print(f"File not found: {path}", file=sys.stderr)
            sys.exit(1)

    try:
        patch_service()
        patch_controller()
    except Exception as error:
        print(f"Patch failed: {error}", file=sys.stderr)
        sys.exit(1)

    print("\nPatch completed successfully.")
    print("NestJS should recompile automatically if dev:api is running.")
    print("Otherwise run: npm run dev:api")


if __name__ == "__main__":
    main()
