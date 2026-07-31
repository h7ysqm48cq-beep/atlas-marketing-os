import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class GenerateContentDto {
  @IsString()
  @IsNotEmpty()
  topic!: string;

  @IsArray()
  @IsString({ each: true })
  platforms!: string[];

  @IsString()
  @IsNotEmpty()
  style!: string;

  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsString()
  @IsOptional()
  campaignId?: string;

  @IsString()
  @IsOptional()
  ideaId?: string;

  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  assetIds?: string[];
}
