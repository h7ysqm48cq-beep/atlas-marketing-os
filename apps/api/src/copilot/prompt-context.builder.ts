import { Injectable } from '@nestjs/common';

export type PromptConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type PromptAttachment = {
  id: string;
  kind: 'image' | 'document';
  name: string;
  mimeType: string;
  url: string;
  documentId?: string;
};

export type PromptContextBuildInput = {
  context: string;
  conversationMessages: PromptConversationMessage[];
  latestUserMessage: string;
  attachments?: PromptAttachment[];
};

@Injectable()
export class PromptContextBuilder {
  build(input: PromptContextBuildInput) {
    const history =
      input.conversationMessages.slice(0, -1);

    const imageAttachments =
      (input.attachments || []).filter(
        (attachment) =>
          attachment.kind === 'image',
      );

    const latestContent: Array<
      | {
          type: 'input_text';
          text: string;
        }
      | {
          type: 'input_image';
          image_url: string;
          detail: 'auto';
        }
    > = [
      {
        type: 'input_text',
        text:
          input.latestUserMessage ||
          'Please review the attached content.',
      },
      ...imageAttachments.map(
        (attachment) => ({
          type: 'input_image' as const,
          image_url: attachment.url,
          detail: 'auto' as const,
        }),
      ),
    ];

    return [
      {
        role: 'developer' as const,
        content: input.context,
      },
      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: 'user' as const,
        content: latestContent,
      },
    ];
  }
}
