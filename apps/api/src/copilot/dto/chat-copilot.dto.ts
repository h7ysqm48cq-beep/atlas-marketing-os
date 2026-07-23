import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

class CopilotMessageDto {
  @IsString()
  @IsNotEmpty()
  role!: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class ChatCopilotDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CopilotMessageDto)
  messages!: CopilotMessageDto[];

  @IsString()
  @IsOptional()
  campaignId?: string;
}
