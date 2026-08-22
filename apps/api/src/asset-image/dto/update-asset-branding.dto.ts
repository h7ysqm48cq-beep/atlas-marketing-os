import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAssetBrandingDto {
  @IsBoolean()
  brandFooterEnabled!: boolean;

  @IsBoolean()
  footerLogoEnabled!: boolean;

  @IsBoolean()
  cornerLogoEnabled!: boolean;

  @IsOptional()
  @IsBoolean()
  qrEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  qrLinks?: string;

  @IsOptional()
  @IsString()
  pageId?: string;

  @IsOptional()
  @IsString()
  channelId?: string;
}
