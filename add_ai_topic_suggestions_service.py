from pathlib import Path
import shutil
import sys

path = Path("apps/api/src/ai/ai.service.ts")

if not path.exists():
    raise SystemExit(f"File not found: {path}")

text = path.read_text(encoding="utf-8")
original = text

# Add DTO type import.
if "TopicSuggestionsDto" not in text:
    marker = (
        "import { GenerateContentDto } "
        "from './dto/generate-content.dto';"
    )

    replacement = (
        marker
        + "\nimport type { TopicSuggestionsDto } "
        + "from './dto/topic-suggestions.dto';"
    )

    if marker not in text:
        raise SystemExit(
            "GenerateContentDto import was not found."
        )

    text = text.replace(
        marker,
        replacement,
        1,
    )

# Insert the service method before previewPrompt().
if "async suggestTopics(" not in text:
    marker = "  async previewPrompt(dto: GenerateContentDto) {"

    method = r'''  async suggestTopics(
    dto: TopicSuggestionsDto,
  ) {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured in apps/api/.env',
      );
    }

    const brand =
      await this.brandsService.getActiveBrand();

    const campaign = dto.campaignId
      ? await this.prisma.campaign.findFirst({
          where: {
            id: dto.campaignId,
            brandId: brand.id,
          },
          select: {
            id: true,
            name: true,
            description: true,
            objective: true,
          },
        })
      : null;

    if (dto.campaignId && !campaign) {
      throw new BadRequestException(
        'Campaign was not found for the active brand.',
      );
    }

    const recentHistory =
      await this.prisma.generationHistory.findMany({
        where: {
          brandId: brand.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 20,
        select: {
          topic: true,
        },
      });

    const count = dto.count ?? 8;

    const recentTopics = recentHistory
      .map((item) => item.topic.trim())
      .filter(Boolean);

    const prompt = [
      'You are Atlas, an AI content strategist.',
      '',
      'Create fresh, practical and non-repetitive content topic ideas.',
      'The topics must be specific enough to generate immediately.',
      'Avoid statistics, current claims or unverifiable facts.',
      '',
      'BRAND',
      `Name: ${brand.name}`,
      `Audience: ${brand.targetAudience}`,
      `Voice: ${brand.brandVoice}`,
      `Content goals: ${brand.contentGoals}`,
      `Keywords: ${brand.keywords.join(', ')}`,
      `Rules: ${brand.brandRules.join(' | ')}`,
      `Forbidden words: ${brand.forbiddenWords.join(', ')}`,
      '',
      'REQUEST',
      `Number of suggestions: ${count}`,
      `Style: ${dto.style}`,
      `Language: ${dto.language}`,
      `Platforms: ${dto.platforms.join(', ')}`,
      `Direction: ${dto.direction?.trim() || 'Open recommendation'}`,
      '',
      'CAMPAIGN',
      campaign
        ? [
            `Name: ${campaign.name}`,
            `Description: ${campaign.description || 'Not provided'}`,
            `Objective: ${campaign.objective || 'Not provided'}`,
          ].join('\n')
        : 'No campaign selected.',
      '',
      'RECENT TOPICS TO AVOID REPEATING',
      recentTopics.length
        ? recentTopics.join('\n')
        : 'No recent topics.',
      '',
      'Each suggestion must contain:',
      '- title: a concise usable topic',
      '- angle: the creative direction',
      '- hook: a possible opening line',
      '- reason: why it suits this brand and audience',
      '',
      'Return only JSON matching the required schema.',
    ].join('\n');

    const model =
      this.configService.get<string>(
        'OPENAI_MODEL',
      ) || 'gpt-4.1-mini';

    try {
      const response =
        await this.client.responses.create({
          model,
          input: prompt,
          text: {
            format: {
              type: 'json_schema',
              name: 'atlas_topic_suggestions',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  suggestions: {
                    type: 'array',
                    minItems: count,
                    maxItems: count,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        title: {
                          type: 'string',
                        },
                        angle: {
                          type: 'string',
                        },
                        hook: {
                          type: 'string',
                        },
                        reason: {
                          type: 'string',
                        },
                      },
                      required: [
                        'title',
                        'angle',
                        'hook',
                        'reason',
                      ],
                    },
                  },
                },
                required: [
                  'suggestions',
                ],
              },
            },
          },
        });

      const parsed = JSON.parse(
        response.output_text,
      ) as {
        suggestions: Array<{
          title: string;
          angle: string;
          hook: string;
          reason: string;
        }>;
      };

      return {
        success: true,
        count:
          parsed.suggestions.length,
        campaign: campaign
          ? {
              id: campaign.id,
              name: campaign.name,
            }
          : null,
        avoidedTopics: recentTopics,
        suggestions:
          parsed.suggestions,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown topic suggestion error';

      throw new InternalServerErrorException(
        `Topic suggestion failed: ${message}`,
      );
    }
  }

'''

    if marker not in text:
        raise SystemExit(
            "previewPrompt() insertion point was not found."
        )

    text = text.replace(
        marker,
        method + marker,
        1,
    )

if text == original:
    print("AiService already contains topic suggestions.")
    sys.exit(0)

backup = path.with_suffix(
    ".ts.bak.topic-suggestions"
)
shutil.copy2(path, backup)

path.write_text(
    text,
    encoding="utf-8",
)

print(f"Backup created: {backup}")
print("AiService topic suggestions added.")
