import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  BrandMemoryFactStatus,
  BrandMemoryFactType,
} from '../../generated/prisma/client';

export class UpdateMemoryFactDto {
  @IsEnum(BrandMemoryFactType)
  @IsOptional()
  type?: BrandMemoryFactType;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  key?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  value?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  confidence?: number;

  @IsEnum(BrandMemoryFactStatus)
  @IsOptional()
  status?: BrandMemoryFactStatus;
}
