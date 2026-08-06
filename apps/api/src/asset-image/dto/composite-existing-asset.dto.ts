import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ImageEditorLayerDto {
  @IsString()
  id!: string;

  @IsIn(['IMAGE', 'LOGO', 'TEXT'])
  type!: 'IMAGE' | 'LOGO' | 'TEXT';

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsNumber()
  @Min(8)
  @Max(240)
  fontSize?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  opacity!: number;

  @IsNumber()
  order!: number;

  @IsBoolean()
  visible!: boolean;

  @IsBoolean()
  locked!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.4)
  @Max(2)
  scale?: number;
}

export class CompositeExistingAssetDto {
  @IsString()
  assetId!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageEditorLayerDto)
  layers!: ImageEditorLayerDto[];
}
