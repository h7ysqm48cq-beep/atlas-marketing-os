import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export enum ExistingAssetLogoPlacement {
  AUTO = 'AUTO',
  TOP_LEFT = 'TOP_LEFT',
  TOP_CENTER = 'TOP_CENTER',
  TOP_RIGHT = 'TOP_RIGHT',
  CENTER_LEFT = 'CENTER_LEFT',
  CENTER = 'CENTER',
  CENTER_RIGHT = 'CENTER_RIGHT',
  BOTTOM_LEFT = 'BOTTOM_LEFT',
  BOTTOM_CENTER = 'BOTTOM_CENTER',
  BOTTOM_RIGHT = 'BOTTOM_RIGHT',
}

export class BrandExistingAssetDto {
  @IsString()
  assetId!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsEnum(ExistingAssetLogoPlacement)
  logoPlacement?: ExistingAssetLogoPlacement;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(1.8)
  logoScale?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.2)
  @Max(1)
  logoOpacity?: number;
}
