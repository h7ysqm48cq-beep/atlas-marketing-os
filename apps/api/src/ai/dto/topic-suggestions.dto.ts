import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class TopicSuggestionsDto {
  @IsString()
  @IsOptional()
  campaignId?: string;

  @IsString()
  @IsNotEmpty()
  style!: string;

  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsArray()
  @IsString({ each: true })
  platforms!: string[];

  @IsInt()
  @Min(3)
  @Max(20)
  @IsOptional()
  count?: number;

  @IsString()
  @IsOptional()
  direction?: string;
}
