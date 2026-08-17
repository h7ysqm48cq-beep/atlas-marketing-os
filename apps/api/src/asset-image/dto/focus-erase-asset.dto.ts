import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class FocusEraseAssetDto {
  @IsString()
  assetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8_000_000)
  maskDataUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instruction?: string;
}
