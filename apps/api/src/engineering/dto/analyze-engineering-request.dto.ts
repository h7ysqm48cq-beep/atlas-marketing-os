import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AnalyzeEngineeringRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @IsString()
  projectRoot?: string;
}
