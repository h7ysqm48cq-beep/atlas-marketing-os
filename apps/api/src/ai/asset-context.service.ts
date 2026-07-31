import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type ResolvedAssetRole =
  | 'USER_SELECTED'
  | 'PRIMARY_LOGO'
  | 'BRAND_BANNER'
  | 'MASCOT'
  | 'STYLE_REFERENCE';

export type ResolvedAiAsset = {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  provider: string | null;
  collection: string | null;
  remark: string | null;
  role: ResolvedAssetRole;
  source: 'USER' | 'BRAND_BRAIN';
};

export type AssetContextResult = {
  assets: ResolvedAiAsset[];
  userAssets: ResolvedAiAsset[];
  brandAssets: ResolvedAiAsset[];
  promptContext: string;
};

type BrandAssetMemory = {
  id: string;
  primaryLogoAssetId: string | null;
  brandBannerAssetId: string | null;
  mascotAssetId: string | null;
  referenceAssetIds: string[];
};

type AssetRoleEntry = {
  id: string;
  role: ResolvedAssetRole;
  source: 'USER' | 'BRAND_BRAIN';
};

@Injectable()
export class AssetContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: {
    brand: BrandAssetMemory;
    selectedAssetIds?: string[];
  }): Promise<AssetContextResult> {
    const userEntries = this.buildUserEntries(input.selectedAssetIds);

    const brandEntries = this.buildBrandEntries(input.brand);

    /*
     * User-selected assets have priority.
     * If the same asset also exists in Brand Brain,
     * only the user-selected version is retained.
     */
    const orderedEntries = this.removeDuplicates([
      ...userEntries,
      ...brandEntries,
    ]);

    if (!orderedEntries.length) {
      return {
        assets: [],
        userAssets: [],
        brandAssets: [],
        promptContext: '',
      };
    }

    const assets = await this.prisma.asset.findMany({
      where: {
        id: {
          in: orderedEntries.map((entry) => entry.id),
        },
        brandId: input.brand.id,
        type: 'IMAGE',
        aiEnabled: true,
      },
      select: {
        id: true,
        name: true,
        url: true,
        thumbnailUrl: true,
        mimeType: true,
        provider: true,
        collection: true,
        remark: true,
      },
    });

    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    const resolvedAssets = orderedEntries
      .map((entry) => {
        const asset = assetById.get(entry.id);

        if (!asset) {
          return null;
        }

        return {
          ...asset,
          role: entry.role,
          source: entry.source,
        } satisfies ResolvedAiAsset;
      })
      .filter((asset): asset is ResolvedAiAsset => asset !== null);

    const userAssets = resolvedAssets.filter(
      (asset) => asset.source === 'USER',
    );

    const brandAssets = resolvedAssets.filter(
      (asset) => asset.source === 'BRAND_BRAIN',
    );

    return {
      assets: resolvedAssets,
      userAssets,
      brandAssets,
      promptContext: this.buildPromptContext({
        userAssets,
        brandAssets,
      }),
    };
  }

  private buildUserEntries(assetIds?: string[]): AssetRoleEntry[] {
    return Array.from(
      new Set((assetIds ?? []).map((id) => id.trim()).filter(Boolean)),
    )
      .slice(0, 4)
      .map((id) => ({
        id,
        role: 'USER_SELECTED',
        source: 'USER',
      }));
  }

  private buildBrandEntries(brand: BrandAssetMemory): AssetRoleEntry[] {
    const entries: AssetRoleEntry[] = [];

    if (brand.primaryLogoAssetId?.trim()) {
      entries.push({
        id: brand.primaryLogoAssetId.trim(),
        role: 'PRIMARY_LOGO',
        source: 'BRAND_BRAIN',
      });
    }

    if (brand.brandBannerAssetId?.trim()) {
      entries.push({
        id: brand.brandBannerAssetId.trim(),
        role: 'BRAND_BANNER',
        source: 'BRAND_BRAIN',
      });
    }

    if (brand.mascotAssetId?.trim()) {
      entries.push({
        id: brand.mascotAssetId.trim(),
        role: 'MASCOT',
        source: 'BRAND_BRAIN',
      });
    }

    const referenceIds = Array.from(
      new Set(
        (brand.referenceAssetIds ?? []).map((id) => id.trim()).filter(Boolean),
      ),
    ).slice(0, 6);

    for (const id of referenceIds) {
      entries.push({
        id,
        role: 'STYLE_REFERENCE',
        source: 'BRAND_BRAIN',
      });
    }

    return entries;
  }

  private removeDuplicates(entries: AssetRoleEntry[]): AssetRoleEntry[] {
    const usedIds = new Set<string>();
    const result: AssetRoleEntry[] = [];

    for (const entry of entries) {
      if (usedIds.has(entry.id)) {
        continue;
      }

      usedIds.add(entry.id);
      result.push(entry);
    }

    return result;
  }

  private buildPromptContext(input: {
    userAssets: ResolvedAiAsset[];
    brandAssets: ResolvedAiAsset[];
  }): string {
    const sections: string[] = [];

    if (input.brandAssets.length) {
      sections.push(
        [
          'BRAND ASSET MEMORY',
          'These are reusable default assets configured in Brand Brain.',
          'Treat their remarks as persistent brand instructions.',
          'Do not force every asset into the output when it is irrelevant.',
          '',
          ...input.brandAssets.map((asset, index) =>
            this.formatAsset(asset, index + 1),
          ),
        ].join('\n\n'),
      );
    }

    if (input.userAssets.length) {
      sections.push(
        [
          'USER SELECTED ASSETS',
          'These assets were explicitly selected for the current generation.',
          'They have higher priority than default Brand Brain assets.',
          '',
          ...input.userAssets.map((asset, index) =>
            this.formatAsset(asset, index + 1),
          ),
        ].join('\n\n'),
      );
    }

    if (!sections.length) {
      return '';
    }

    return [
      ...sections,
      'ASSET USAGE RULES',
      '- Follow each asset remark when relevant.',
      '- The current explicit user request has highest priority.',
      '- Mandatory Brand Brain rules and forbidden words remain in force.',
      '- Never expose internal asset IDs or internal context labels.',
      '- Do not claim an asset was used unless it is relevant to the requested output.',
    ].join('\n\n');
  }

  private formatAsset(asset: ResolvedAiAsset, number: number): string {
    return [
      `Asset ${number}`,
      `Role: ${this.roleLabel(asset.role)}`,
      `Name: ${asset.name}`,
      `Collection: ${asset.collection || 'Not assigned'}`,
      `Provider: ${asset.provider || 'Not specified'}`,
      `Image URL: ${asset.url}`,
      'Usage instruction:',
      asset.remark?.trim() ||
        'No specific remark was supplied. Use only when relevant.',
    ].join('\n');
  }

  buildVisionInput(prompt: string, assets: ResolvedAiAsset[]) {
    const supportedMimeTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);

    const visionAssets = assets
      .filter((asset) => {
        const mimeType = asset.mimeType?.trim().toLowerCase();

        return (
          asset.url.startsWith('https://') &&
          Boolean(mimeType) &&
          supportedMimeTypes.has(mimeType!)
        );
      })
      .slice(0, 8);

    if (!visionAssets.length) {
      return prompt;
    }

    return [
      {
        role: 'user' as const,
        content: [
          {
            type: 'input_text' as const,
            text: prompt,
          },
          ...visionAssets.map((asset) => ({
            type: 'input_image' as const,
            image_url: asset.url,
            detail: 'auto' as const,
          })),
        ],
      },
    ];
  }

  private roleLabel(role: ResolvedAssetRole): string {
    const labels: Record<ResolvedAssetRole, string> = {
      USER_SELECTED: 'User-selected reference',
      PRIMARY_LOGO: 'Primary brand logo',
      BRAND_BANNER: 'Default brand banner',
      MASCOT: 'Brand mascot or recurring character',
      STYLE_REFERENCE: 'Visual style reference',
    };

    return labels[role];
  }
}
