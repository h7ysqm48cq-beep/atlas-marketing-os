import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateCampaignPlanDto {
  @IsInt()
  @Min(3)
  @Max(30)
  count!: number;

  @IsString()
  @IsNotEmpty()
  direction!: string;

  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsString()
  @IsNotEmpty()
  style!: string;

  @IsString()
  @IsOptional()
  platform?: string;
}
