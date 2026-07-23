import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class RewriteContentDto {
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsIn(['improve', 'rewrite', 'translate', 'shorter', 'longer'])
  action!: 'improve' | 'rewrite' | 'translate' | 'shorter' | 'longer';

  @IsString()
  @IsNotEmpty()
  platform!: string;

  @IsString()
  @IsOptional()
  campaignId?: string;

  @IsString()
  @IsOptional()
  targetLanguage?: string;

  @IsIn([
    'Default',
    'Funny',
    'Professional',
    'Malaysian Chinese',
    'Emotional',
    'Luxury',
    'Gen Z',
  ])
  @IsOptional()
  tone?: string;

  @IsIn([
    'Balanced',
    'More Viral',
    'Better Hook',
    'More Comments',
    'More Shares',
    'Stronger CTA',
  ])
  @IsOptional()
  goal?: string;

  @IsIn(['Auto', 'Short', 'Medium', 'Long'])
  @IsOptional()
  length?: string;
}
