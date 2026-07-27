import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(12000)
  content!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
