import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ContentStatus } from '../../generated/prisma/client';

export class UpdateHistoryStatusDto {
  @IsEnum(ContentStatus)
  status!: ContentStatus;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reviewNote?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  reviewedBy?: string;
}
