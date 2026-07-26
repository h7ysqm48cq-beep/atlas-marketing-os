import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMarketingPlanDto {
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsString()
  @IsOptional()
  campaignId?: string;
}
