import {
  IsEnum,
  IsInt,
  IsNotEmpty,
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

export class CreateMemoryFactDto {
  @IsEnum(BrandMemoryFactType)
  @IsOptional()
  type?: BrandMemoryFactType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  value!: string;

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

  @IsString()
  @IsOptional()
  @MaxLength(60)
  sourceType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  sourceId?: string;
}
