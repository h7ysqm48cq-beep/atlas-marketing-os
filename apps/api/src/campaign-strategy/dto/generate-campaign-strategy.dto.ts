import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GenerateCampaignStrategyDto {
  @IsString()
  campaignId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  objective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetAudience?: string;

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(90)
  durationDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  platforms?: string[];

  @IsOptional()
  @IsString()
  style?: string;

  @IsOptional()
  @IsString()
  language?: string;
}
