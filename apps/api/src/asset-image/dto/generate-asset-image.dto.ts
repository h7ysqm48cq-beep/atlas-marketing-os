import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class GenerateAssetImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  campaignId?: string;

  @IsString()
  @IsOptional()
  historyId?: string;

  @IsString()
  @IsOptional()
  platform?: string;

  @IsIn(['1024x1024', '1024x1536', '1536x1024'])
  @IsOptional()
  size?: '1024x1024' | '1024x1536' | '1536x1024';

  @IsIn(['low', 'medium', 'high', 'auto'])
  @IsOptional()
  quality?: 'low' | 'medium' | 'high' | 'auto';
}
