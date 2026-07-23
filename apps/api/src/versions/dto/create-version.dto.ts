import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateVersionDto {
  @IsString()
  @IsNotEmpty()
  historyId!: string;

  @IsString()
  @IsNotEmpty()
  platform!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsString()
  @IsOptional()
  sourceAction?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  versionNumber?: number;
}
