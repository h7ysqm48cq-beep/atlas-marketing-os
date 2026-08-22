import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAssetBrandingDto {
  @IsBoolean()
  brandFooterEnabled!: boolean;

  @IsBoolean()
  footerLogoEnabled!: boolean;

  @IsBoolean()
  cornerLogoEnabled!: boolean;

  @IsOptional()
  @IsString()
  pageId?: string;

  @IsOptional()
  @IsString()
  channelId?: string;
}
