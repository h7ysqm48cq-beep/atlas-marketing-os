import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { LeadActivityType } from '../../../generated/prisma/client';

export class CreateLeadActivityDto {
  @IsEnum(LeadActivityType)
  type!: LeadActivityType;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(-100)
  @Max(100)
  scoreDelta?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
