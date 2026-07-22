import { IsArray, IsIn, IsNotEmpty, IsString } from 'class-validator';

export class GenerateContentDto {
  @IsString()
  @IsNotEmpty()
  topic!: string;

  @IsArray()
  @IsString({ each: true })
  platforms!: string[];

  @IsString()
  @IsIn(['Nostalgia', 'Funny', 'Motivation', 'Lifestyle', 'Soft Sell'])
  style!: string;

  @IsString()
  @IsIn(['Chinese', 'English', 'Bilingual'])
  language!: string;
}
