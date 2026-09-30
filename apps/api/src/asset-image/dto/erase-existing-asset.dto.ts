import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class EraseExistingAssetDto {
  @IsString()
  assetId!: string;

  @IsString()
  maskDataUrl!: string;

  @IsOptional()
  @IsIn(['quick', 'ai'])
  mode?: 'quick' | 'ai';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;
}
