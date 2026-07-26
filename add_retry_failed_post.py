from pathlib import Path
import shutil
import sys

SERVICE = Path(
    "apps/api/src/automation/automation.service.ts"
)

CONTROLLER = Path(
    "apps/api/src/automation/automation.controller.ts"
)


def backup(path: Path, suffix: str) -> None:
    target = path.with_suffix(path.suffix + suffix)
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def patch_service() -> None:
    text = SERVICE.read_text(encoding="utf-8")
    original = text

    marker = '''  async cancelPost(
'''

    method = '''  async retryPost(id: string) {
    const post = await this.getPost(id);

    if (
      post.status !==
      ScheduledPostStatus.FAILED
    ) {
      throw new BadRequestException(
        'Only failed posts can be retried.',
      );
    }

    return this.prisma.scheduledPost.update({
      where: {
        id,
      },
      data: {
        status:
          ScheduledPostStatus.QUEUED,
        lastError: null,
        scheduledAt: new Date(),
      },
      include: {
        channel: true,
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        history: {
          select: {
            id: true,
            topic: true,
            status: true,
          },
        },
        attempts: {
          orderBy: {
            attemptNumber: 'desc',
          },
        },
      },
    });
  }

  async cancelPost(
'''

    if "async retryPost(id: string)" not in text:
        if marker not in text:
            raise RuntimeError(
                "Could not find cancelPost method marker."
            )

        text = text.replace(marker, method, 1)

    if text == original:
        print("automation.service.ts already patched.")
        return

    backup(SERVICE, ".bak.retry-post")
    SERVICE.write_text(text, encoding="utf-8")
    print("Updated automation.service.ts")


def patch_controller() -> None:
    text = CONTROLLER.read_text(encoding="utf-8")
    original = text

    marker = '''  @Post('posts/:id/cancel')
'''

    route = '''  @Post('posts/:id/retry')
  retryPost(
    @Param('id') id: string,
  ) {
    return this.automationService.retryPost(id);
  }

  @Post('posts/:id/cancel')
'''

    if "@Post('posts/:id/retry')" not in text:
        if marker not in text:
            raise RuntimeError(
                "Could not find cancel route marker."
            )

        text = text.replace(marker, route, 1)

    if text == original:
        print("automation.controller.ts already patched.")
        return

    backup(CONTROLLER, ".bak.retry-post")
    CONTROLLER.write_text(text, encoding="utf-8")
    print("Updated automation.controller.ts")


def main() -> None:
    for path in (SERVICE, CONTROLLER):
        if not path.exists():
            print(f"File not found: {path}", file=sys.stderr)
            sys.exit(1)

    try:
        patch_service()
        patch_controller()
    except Exception as error:
        print(f"Patch failed: {error}", file=sys.stderr)
        sys.exit(1)

    print("")
    print("Retry failed post API added.")


if __name__ == "__main__":
    main()
