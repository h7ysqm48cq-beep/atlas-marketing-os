import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

class CopilotMessageDto {
  @IsString()
  @IsNotEmpty()
  role!: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content!: string;
}


class CopilotAttachmentDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsIn(['image', 'document'])
  kind!: 'image' | 'document';

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsUrl({
    require_protocol: true,
    protocols: ['https'],
  })
  url!: string;

  @IsString()
  @IsOptional()
  storageProvider?: string;

  @IsString()
  @IsOptional()
  storagePath?: string;

  @IsString()
  @IsOptional()
  documentId?: string;
}

export class ChatCopilotDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CopilotMessageDto)
  messages!: CopilotMessageDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CopilotAttachmentDto)
  attachments?: CopilotAttachmentDto[];

  @IsString()
  @IsOptional()
  campaignId?: string;

  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsOptional()
  @IsIn(['chat', 'marketing-plan'])
  mode?: 'chat' | 'marketing-plan';
}
