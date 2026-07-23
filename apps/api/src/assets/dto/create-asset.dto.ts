import {
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

  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;
}
