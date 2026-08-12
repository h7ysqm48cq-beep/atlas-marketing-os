import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EraseExistingAssetDto {
  @IsString()
  assetId!: string;

  @IsString()
  maskDataUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;
}
