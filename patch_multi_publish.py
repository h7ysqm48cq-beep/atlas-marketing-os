from pathlib import Path
import shutil
import sys

SERVICE = Path(
    "apps/api/src/automation/automation.service.ts"
)
CONTROLLER = Path(
    "apps/api/src/automation/automation.controller.ts"
)

SERVICE_METHOD = r'''
  async createMultiPlatformPosts(input: {
    brandId: string;
    campaignId?: string;
    historyId?: string;
    title?: string;
    contents: Partial<
      Record<
        SocialPlatform,
        string
      >
    >;
    mediaUrls?: Partial<
      Record<
        SocialPlatform,
        string[]
      >
    >;
    platforms: SocialPlatform[];
    scheduledAt: string;
    timezone?: string;
    queueImmediately?: boolean;
  }) {
    if (
      !input.platforms?.length
    ) {
      throw new BadRequestException(
        'At least one platform is required.',
      );
    }

    const uniquePlatforms = [
      ...new Set(input.platforms),
    ];

    const channels =
      await this.prisma.socialChannel.findMany({
        where: {
          brandId: input.brandId,
          platform: {
            in: uniquePlatforms,
          },
          status:
            SocialChannelStatus.CONNECTED,
        },
      });

    const channelByPlatform =
      new Map(
        channels.map((channel) => [
          channel.platform,
          channel,
        ]),
      );

    const missingPlatforms =
      uniquePlatforms.filter(
        (platform) =>
          !channelByPlatform.has(platform),
      );

    if (missingPlatforms.length) {
      throw new BadRequestException(
        `Connected channel missing for: ${missingPlatforms.join(', ')}`,
      );
    }

    const createdPosts = [];

    for (
      const platform of uniquePlatforms
    ) {
      const content =
        input.contents?.[platform]?.trim();

      if (!content) {
        throw new BadRequestException(
          `Content is required for ${platform}.`,
        );
      }

      const channel =
        channelByPlatform.get(platform);

      if (!channel) {
        throw new BadRequestException(
          `Channel not found for ${platform}.`,
        );
      }

      const post =
        await this.createPost({
          brandId: input.brandId,
          channelId: channel.id,
          campaignId:
            input.campaignId,
          historyId:
            input.historyId,
          platform,
          title:
            input.title,
          content,
          mediaUrls:
            input.mediaUrls?.[
              platform
            ] ?? [],
          scheduledAt:
            input.scheduledAt,
          timezone:
            input.timezone,
          status:
            input.queueImmediately
              ? ScheduledPostStatus.QUEUED
              : ScheduledPostStatus.DRAFT,
        });

      createdPosts.push(post);
    }

    return {
      success: true,
      count: createdPosts.length,
      posts: createdPosts.map(
        (post) => ({
          id: post.id,
          platform:
            post.platform,
          status:
            post.status,
          scheduledAt:
            post.scheduledAt,
          channel: {
            id: post.channel.id,
            name:
              post.channel.name,
          },
        }),
      ),
    };
  }

'''

CONTROLLER_METHOD = r'''
  @Post('multi-publish')
  multiPublish(
    @Body()
    body: {
      brandId: string;
      campaignId?: string;
      historyId?: string;
      title?: string;
      contents: Partial<
        Record<
          SocialPlatform,
          string
        >
      >;
      mediaUrls?: Partial<
        Record<
          SocialPlatform,
          string[]
        >
      >;
      platforms: SocialPlatform[];
      scheduledAt: string;
      timezone?: string;
      queueImmediately?: boolean;
    },
  ) {
    return this.automationService
      .createMultiPlatformPosts(body);
  }

'''


def backup(path: Path, suffix: str) -> None:
    target = path.with_suffix(
        path.suffix + suffix
    )
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def patch_service() -> None:
    text = SERVICE.read_text(
        encoding="utf-8"
    )

    if (
        "async createMultiPlatformPosts("
        in text
    ):
        print(
            "Service multi-publish method "
            "already exists."
        )
        return

    marker = (
        "  async updatePost(\n"
    )

    if marker not in text:
        raise RuntimeError(
            "Could not find updatePost() "
            "marker in automation.service.ts"
        )

    backup(
        SERVICE,
        ".bak.multi-publish",
    )

    text = text.replace(
        marker,
        SERVICE_METHOD + marker,
        1,
    )

    SERVICE.write_text(
        text,
        encoding="utf-8",
    )

    print(
        "Updated automation.service.ts"
    )


def patch_controller() -> None:
    text = CONTROLLER.read_text(
        encoding="utf-8"
    )

    if (
        "@Post('multi-publish')"
        in text
    ):
        print(
            "Controller multi-publish "
            "endpoint already exists."
        )
        return

    marker = (
        "  @Patch('posts/:id')\n"
    )

    if marker not in text:
        raise RuntimeError(
            "Could not find posts/:id "
            "marker in automation.controller.ts"
        )

    backup(
        CONTROLLER,
        ".bak.multi-publish",
    )

    text = text.replace(
        marker,
        CONTROLLER_METHOD + marker,
        1,
    )

    CONTROLLER.write_text(
        text,
        encoding="utf-8",
    )

    print(
        "Updated automation.controller.ts"
    )


def main() -> None:
    for path in (
        SERVICE,
        CONTROLLER,
    ):
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
    print(
        "Multi-platform publish patch "
        "completed."
    )


if __name__ == "__main__":
    main()
