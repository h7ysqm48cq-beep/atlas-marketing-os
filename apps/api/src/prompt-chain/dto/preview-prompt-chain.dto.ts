import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PreviewPromptChainDto {
  @IsString()
  @IsNotEmpty()
  topic!: string;

  @IsString()
  @IsOptional()
  platform?: string;

  @IsString()
  @IsOptional()
  style?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  campaignId?: string;
}
