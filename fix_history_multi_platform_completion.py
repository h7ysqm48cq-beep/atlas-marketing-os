from pathlib import Path
import re
import shutil
import sys

PATH = Path(
    "apps/api/src/automation/publisher.service.ts"
)


def main() -> None:
    if not PATH.exists():
        print(f"File not found: {PATH}", file=sys.stderr)
        sys.exit(1)

    text = PATH.read_text(encoding="utf-8")
    original = text

    # Replace the old immediate History update.
    direct_sync_pattern = re.compile(
        r'''
        \s*if\s*\(post\.historyId\)\s*\{
          \s*await\s+this\.prisma\.generationHistory\.update\(\{
            \s*where:\s*\{
              \s*id:\s*post\.historyId,
            \s*\},
            \s*data:\s*\{
              \s*status:
                \s*ContentStatus\.PUBLISHED,
              \s*publishedAt:
                \s*new\s+Date\(\),
            \s*\},
          \s*\}\);
        \s*\}
        ''',
        re.VERBOSE,
    )

    if "syncHistoryPublishedStatus" not in text:
        match = direct_sync_pattern.search(text)

        if not match:
            print(
                "Could not find the existing direct History sync block.",
                file=sys.stderr,
            )
            sys.exit(1)

        replacement = '''

        if (post.historyId) {
          await this.syncHistoryPublishedStatus(
            post.historyId,
          );
        }
'''

        text = (
            text[:match.start()]
            + replacement
            + text[match.end():]
        )

    # Add helper before the final class brace.
    if "private async syncHistoryPublishedStatus(" not in text:
        helper = r'''
  private async syncHistoryPublishedStatus(
    historyId: string,
  ) {
    const linkedPosts =
      await this.prisma.scheduledPost.findMany({
        where: {
          historyId,
          status: {
            not: ScheduledPostStatus.CANCELLED,
          },
        },
        select: {
          id: true,
          platform: true,
          status: true,
        },
      });

    if (!linkedPosts.length) {
      return;
    }

    const allPublished =
      linkedPosts.every(
        (linkedPost) =>
          linkedPost.status ===
          ScheduledPostStatus.PUBLISHED,
      );

    if (!allPublished) {
      this.logger.log(
        [
          `History ${historyId} is not complete.`,
          linkedPosts
            .map(
              (linkedPost) =>
                `${linkedPost.platform}=${linkedPost.status}`,
            )
            .join(', '),
        ].join(' '),
      );

      return;
    }

    await this.prisma.generationHistory.update({
      where: {
        id: historyId,
      },
      data: {
        status:
          ContentStatus.PUBLISHED,
        publishedAt:
          new Date(),
        reviewedBy:
          'Atlas Publisher',
      },
    });

    this.logger.log(
      `History ${historyId} marked as published.`,
    );
  }

'''

        final_brace = text.rfind("\n}")

        if final_brace == -1:
            print(
                "Could not find PublisherService class closing brace.",
                file=sys.stderr,
            )
            sys.exit(1)

        text = (
            text[:final_brace]
            + "\n"
            + helper
            + text[final_brace:]
        )

    if text == original:
        print("PublisherService already uses completion validation.")
        return

    backup = PATH.with_suffix(
        ".ts.bak.multi-platform-completion"
    )
    shutil.copy2(PATH, backup)

    PATH.write_text(text, encoding="utf-8")

    print(f"Backup created: {backup}")
    print("Multi-platform History completion validation added.")


if __name__ == "__main__":
    main()
