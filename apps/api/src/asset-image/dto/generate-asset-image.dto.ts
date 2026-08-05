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

  @IsIn(['AUTO', 'ALWAYS', 'NEVER'])
  @IsOptional()
  logoMode?: 'AUTO' | 'ALWAYS' | 'NEVER';

  @IsIn([
    'AUTO',
    'TOP_LEFT',
    'TOP_CENTER',
    'TOP_RIGHT',
    'CENTER_LEFT',
    'CENTER',
    'CENTER_RIGHT',
    'BOTTOM_LEFT',
    'BOTTOM_CENTER',
    'BOTTOM_RIGHT',
  ])
  @IsOptional()
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
}
