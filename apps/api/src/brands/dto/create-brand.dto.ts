import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateBrandDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  industry?: string;

  @IsString()
  @IsNotEmpty()
  country!: string;

  @IsString()
  @IsNotEmpty()
  primaryLanguage!: string;

  @IsString()
  @IsNotEmpty()
  targetAudience!: string;

  @IsString()
  @IsNotEmpty()
  brandVoice!: string;

  @IsString()
  @IsNotEmpty()
  visualStyle!: string;

  @IsString()
  @IsNotEmpty()
  contentGoals!: string;

  @IsArray()
  @IsString({ each: true })
  callsToAction!: string[];

  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsArray()
  @IsString({ each: true })
  forbiddenWords!: string[];

  @IsArray()
  @IsString({ each: true })
  brandRules!: string[];

  @IsArray()
  @IsString({ each: true })
  examplePosts!: string[];
}
