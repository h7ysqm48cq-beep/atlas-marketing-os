import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class AiEditExistingAssetDto {
  @IsString()
  assetId!: string;

  @IsString()
  @MaxLength(12000)
  prompt!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  preserveComposition?: boolean;

  @IsOptional()
  @IsBoolean()
  preservePeople?: boolean;

  @IsOptional()
  @IsBoolean()
  preserveBranding?: boolean;
}
