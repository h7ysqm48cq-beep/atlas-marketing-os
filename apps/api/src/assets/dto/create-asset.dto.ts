import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { AssetType } from '../../generated/prisma/client';

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(AssetType)
  @IsOptional()
  type?: AssetType;

  @IsString()
  @IsOptional()
  campaignId?: string;

  @IsString()
  @IsOptional()
  historyId?: string;

  @IsString()
  @IsOptional()
  provider?: string;

  @IsString()
  @IsOptional()
  platform?: string;

  @IsString()
  @IsOptional()
  prompt?: string;

  @IsString()
  @IsOptional()
  revisedPrompt?: string;

  @IsString()
  @IsOptional()
  negativePrompt?: string;

  @IsString()
  @IsOptional()
  generationModel?: string;

  @IsString()
  @IsOptional()
  generationSize?: string;

  @IsString()
  @IsOptional()
  generationQuality?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  generationDurationMs?: number;

  @IsString()
  @IsOptional()
  storageProvider?: string;

  @IsString()
  @IsOptional()
  storagePath?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  fileSize?: number;

  @IsUrl({
    require_protocol: true,
  })
  url!: string;

  @IsUrl({
    require_protocol: true,
  })
  @IsOptional()
  thumbnailUrl?: string;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  width?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  height?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  collection?: string;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsBoolean()
  @IsOptional()
  aiEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  downloadCount?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  usedCount?: number;
}
