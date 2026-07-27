import {
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @MinLength(2)
  prompt: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[];

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  style?: string;
}
