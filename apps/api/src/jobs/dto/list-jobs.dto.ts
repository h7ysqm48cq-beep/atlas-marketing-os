import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  BackgroundJobStatus,
  BackgroundJobType,
} from '../../generated/prisma/enums';

export class ListJobsDto {
  @IsOptional()
  @IsEnum(BackgroundJobStatus)
  status?: BackgroundJobStatus;

  @IsOptional()
  @IsEnum(BackgroundJobType)
  type?: BackgroundJobType;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
