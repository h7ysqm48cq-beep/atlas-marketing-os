import { Injectable } from '@nestjs/common';

type RecallConversation = {
  title: string;
  mode: string;
  updatedAt: Date;
  messages: {
    role: string;
    content: string;
  }[];
};

@Injectable()
export class ConversationRecallContextBuilder {
  build(
    conversations: RecallConversation[],
  ): string {
    if (!conversations.length) {
      return [
        'PREVIOUS CONVERSATION MEMORY',
        '- No relevant previous conversations found.',
      ].join('\n');
    }

    const lines = [
      'PREVIOUS CONVERSATION MEMORY',
      '',
      'Relevant previous discussions:',
    ];

    conversations.forEach(
      (conversation, index) => {
        lines.push(
          `${index + 1}. ${conversation.title}`,
        );

        conversation.messages.forEach(
          (message) => {
            const content = message.content
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 300);

            if (!content) {
              return;
            }

            lines.push(
              `- ${message.role}: ${content}`,
            );
          },
        );

        lines.push('');
      },
    );

    lines.push(
      'Use previous conversations as context only.',
    );

    lines.push(
      'Current user request has priority.',
    );

    return lines.join('\n');
  }
}
