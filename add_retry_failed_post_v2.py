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


def insert_before_final_class_brace(
    text: str,
    code: str,
) -> str:
    index = text.rfind("\n}")

    if index == -1:
        raise RuntimeError(
            "Could not locate class closing brace."
        )

    return text[:index] + "\n\n" + code + text[index:]


def patch_service() -> None:
    text = SERVICE.read_text(encoding="utf-8")
    original = text

    if "async retryPost(id: string)" in text:
        print("automation.service.ts already has retryPost().")
        return

    method = '''  async retryPost(id: string) {
    const post = await this.getPost(id);

    if (
      post.statusfrom pathlib ieduledPostStatus.FAILED
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
'''

    text = insert_before_final_class_brace(
        text,
        method,
    )

    backup(SERVICE, ".bak.retry-v2")
    SERVICE.write_text(text, encoding="utf-8")
    print("Updated automation.service.ts")


def patch_controller() -> None:
    text = CONTROLLER.read_text(encoding="utf-8")

    if "@Post('posts/:id/retry')" in text:
        print("automation.controller.ts already has retry route.")
        return

    route = '''  @Post('posts/:id/retry')
  retryPost(
    @Param('id') id: string,
  ) {
    return this.automationService.retryPost(id);
  }

'''

    markers = [
        "  @Post('posts/:id/cancel')",
        '  @Post("posts/:id/cancel")',
        "  @Post('facebook/test')",
        '  @Post("facebook/test")',
    ]

    for marker in markers:
        if marker in text:
            text = text.replace(
                marker,
                route + marker,
                1,
            )
            break
    else:
        raise RuntimeError(
            "Could not locate a controller insertion point."
        )

    backup(CONTROLLER, ".bak.retry-v2")
    CONTROLLER.write_text(text, encoding="utf-8")
    print("Updated automation.controller.ts")


def main() -> None:
    for path in (SERVICE, CONTROLLER):
        if not path.exists():
            print(
                f"File not found: {path}",
                file=sys.stderr,
            )
            sys.exit(1)

    try:
        patch_service()
        patch_controller()
    except Exception as error:
        print(
            f"Patch failed: {error}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("")
    print("Retry failed post API added.")


if __name__ == "__main__":
    main()
