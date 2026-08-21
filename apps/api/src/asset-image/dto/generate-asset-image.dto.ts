import {
  IsIn,
  IsNotEmpty,
  IsNumber,
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
  conversationId?: string;

  @IsNumber()
  @IsOptional()
  messageIndex?: number;

  @IsString()
  @IsOptional()
  platform?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsIn(['1024x1024', '1024x1536', '1536x1024'])
  @IsOptional()
  size?: '1024x1024' | '1024x1536' | '1536x1024';

  @IsIn(['low', 'medium', 'high', 'auto'])
  @IsOptional()
  quality?: 'low' | 'medium' | 'high' | 'auto';



  @IsOptional()
  @IsString()
  pageId?: string;

  @IsOptional()
  @IsString()
  channelId?: string;


  /**
   * Controls logo rendering behavior.
   * AUTO    = follow brand settings
   * ALWAYS  = force logo rendering
   * NEVER   = disable logo rendering
   */
  logoMode?: 'AUTO' | 'ALWAYS' | 'NEVER';

}
