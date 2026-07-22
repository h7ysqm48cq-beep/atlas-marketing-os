import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class GenerateImageDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsString()
  @IsIn(['1024x1024', '1536x1024', '1024x1536'])
  size!: '1024x1024' | '1536x1024' | '1024x1536';

  @IsString()
  @IsIn(['low', 'medium', 'high'])
  quality!: 'low' | 'medium' | 'high';
}
