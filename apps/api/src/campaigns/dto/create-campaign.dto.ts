import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { CampaignStatus } from '../../generated/prisma/client';

export type BrandRenderingSettingsInput = {
  logoMode?: 'AUTO' | 'ALWAYS' | 'NEVER';
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
  logoScale?: number;
  logoOpacity?: number;
  websiteEnabled?: boolean;
  qrEnabled?: boolean;
};

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  objective?: string;

  @IsEnum(CampaignStatus)
  @IsOptional()
  status?: CampaignStatus;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsObject()
  @IsOptional()
  brandRenderingSettings?: BrandRenderingSettingsInput;
}
