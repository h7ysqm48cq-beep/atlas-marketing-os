import {
  IsIn,
  IsInt,
  MaxLength,
  Max,
  Matches,
  Min,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class GenerateAssetImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  campaignId?: string;

  @IsString()
  @IsOptional()
  historyId?: string;

  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsNumber()
  @IsOptional()
  messageIndex?: number;

  @IsString()
  @IsOptional()
  platform?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsIn(['1024x1024', '1024x1536', '1536x1024'])
  @IsOptional()
  size?: '1024x1024' | '1024x1536' | '1536x1024';

  @IsIn(['low', 'medium', 'high', 'auto'])
  @IsOptional()
  quality?: 'low' | 'medium' | 'high' | 'auto';

  /**
   * Controls the optional main text overlay independently from asset metadata.
   * AUTO follows the effective image-generation setting.
   */
  @IsIn(['AUTO', 'ALWAYS', 'NEVER'])
  @IsOptional()
  textOverlayMode?: 'AUTO' | 'ALWAYS' | 'NEVER';

  /** Explicit user copy for the main overlay. Never falls back to asset metadata. */
  @IsString()
  @IsOptional()
  @MaxLength(70)
  textOverlayText?: string;

  /** Multiple QR destinations, one http(s) URL per line, maximum 3. */
  @IsIn(['AUTO', 'ALWAYS', 'NEVER'])
  @IsOptional()
  qrMode?: 'AUTO' | 'ALWAYS' | 'NEVER';

  @IsString()
  @IsOptional()
  @MaxLength(600)
  qrLinks?: string;

  @IsOptional()
  @IsString()
  pageId?: string;

  @IsOptional()
  @IsString()
  channelId?: string;

  /**
   * Controls logo rendering behavior.
   * AUTO    = follow brand settings
   * ALWAYS  = force logo rendering
   * NEVER   = disable logo rendering
   */
  @IsIn(['AUTO', 'ALWAYS', 'NEVER'])
  @IsOptional()
  logoMode?: 'AUTO' | 'ALWAYS' | 'NEVER';

  @IsIn(['AUTO', 'ALWAYS', 'NEVER'])
  @IsOptional()
  brandFooterMode?: 'AUTO' | 'ALWAYS' | 'NEVER';

  @IsIn(['AUTO', 'SHOW', 'HIDE'])
  @IsOptional()
  footerLogoMode?: 'AUTO' | 'SHOW' | 'HIDE';

  @IsString()
  @IsOptional()
  @MaxLength(100)
  footerText?: string;

  @IsIn([
    'AUTO',
    'TOP_LEFT',
    'TOP_CENTER',
    'TOP_RIGHT',
    'CENTER_LEFT',
    'CENTER',
    'CENTER_RIGHT',
    'BOTTOM_LEFT',
    'BOTTOM_CENTER',
    'BOTTOM_RIGHT',
  ])
  @IsOptional()
  logoPlacement?:
    | 'AUTO'
    | 'TOP_LEFT'
    | 'TOP_CENTER'
    | 'TOP_RIGHT'
    | 'CENTER_LEFT'
    | 'CENTER'
    | 'CENTER_RIGHT'
    | 'BOTTOM_LEFT'
    | 'BOTTOM_CENTER'
    | 'BOTTOM_RIGHT';

  @IsNumber()
  @Min(0.5)
  @Max(1.5)
  @IsOptional()
  logoScale?: number;

  @IsNumber()
  @Min(0.2)
  @Max(1)
  @IsOptional()
  logoOpacity?: number;

  @IsInt()
  @Min(256)
  @Max(4096)
  @IsOptional()
  outputWidth?: number;

  @IsInt()
  @Min(256)
  @Max(4096)
  @IsOptional()
  outputHeight?: number;

  @IsString()
  @Matches(/^\d{1,2}:\d{1,2}$/)
  @IsOptional()
  aspectRatio?: string;
}
