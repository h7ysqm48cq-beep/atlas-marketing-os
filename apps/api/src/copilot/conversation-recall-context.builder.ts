import { Injectable } from '@nestjs/common';

type RecallMessage = {
  role: string;
  content: string;
};

@Injectable()
export class ConversationRecallContextBuilder {
  private readonly correctionSignals = [
    '不是',
    '不对',
    '错了',
    '错的',
    '记错',
    '忘记',
    '你又忘记',
    '明明说好',
    '应该是',
    '正确的是',
    '改成',
    '换成',
    '以这个为准',
    '以这套为准',
    '切记',
    '记住',
    '不要重新设计',
    '不要再',
    '我说的是',
    '我指的是',
    'no,',
    'no ',
    'wrong',
    'incorrect',
    'actually',
    'should be',
    'i meant',
    'remember that',
  ];

  private readonly confirmationSignals = [
    '对',
    '没错',
    '就是这个',
    '就用这个',
    '这样就好',
    '可以',
    '确定',
    '确认',
    '以这个为准',
    '以这套为准',
    '记住',
    '切记',
    'correct',
    'exactly',
    'yes',
    'confirmed',
    'use this',
    'this is right',
  ];

  buildMessages(messages: RecallMessage[]): string {
    const cleaned = messages
      .map((message) => ({
        role: message.role,
        content: this.clean(message.content),
      }))
      .filter((message) => message.content);

    if (!cleaned.length) {
      return '';
    }

    /*
     * Historical conversations frequently contain:
     *
     * Assistant: incorrect assumption
     * User: correction
     * Assistant: corrected answer
     *
     * When a user explicitly corrects the conversation,
     * prefer the correction and everything after it.
     */
    let correctionIndex = -1;

    for (let index = cleaned.length - 1; index >= 0; index--) {
      const message = cleaned[index];

      if (
        this.isUser(message.role) &&
        this.hasSignal(message.content, this.correctionSignals)
      ) {
        correctionIndex = index;
        break;
      }
    }

    let selected =
      correctionIndex >= 0 ? cleaned.slice(correctionIndex) : cleaned.slice(-6);

    /*
     * Keep recall compact.
     *
     * If no explicit correction exists, favor the most recent
     * user/assistant turns rather than replaying a long transcript.
     */
    selected = selected.slice(-6);

    return selected
      .map((message) => {
        const role = this.isUser(message.role)
          ? 'User'
          : message.role.toUpperCase() === 'ASSISTANT'
            ? 'Assistant'
            : message.role;

        const flags: string[] = [];

        if (
          this.isUser(message.role) &&
          this.hasSignal(message.content, this.correctionSignals)
        ) {
          flags.push('USER CORRECTION');
        }

        if (
          this.isUser(message.role) &&
          this.isUserConfirmation(message.content)
        ) {
          flags.push('USER CONFIRMATION');
        }

        const prefix = flags.length ? `[${flags.join(' + ')}] ` : '';

        return `${role}: ${prefix}${message.content}`;
      })
      .join('\n');
  }

  buildFromEmbeddedContent(content: string): string {
    if (!content?.trim()) {
      return '';
    }

    const lines = content.split('\n');

    const headerLines: string[] = [];
    const messages: RecallMessage[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        continue;
      }

      if (line.startsWith('Conversation:') || line.startsWith('Mode:')) {
        headerLines.push(line);
        continue;
      }

      if (line.startsWith('User:')) {
        messages.push({
          role: 'USER',
          content: line.slice('User:'.length).trim(),
        });
        continue;
      }

      if (line.startsWith('Assistant:')) {
        messages.push({
          role: 'ASSISTANT',
          content: line.slice('Assistant:'.length).trim(),
        });
      }
    }

    const selected = this.buildMessages(messages);

    return [...headerLines, selected].filter(Boolean).join('\n');
  }

  private isUserConfirmation(content: string): boolean {
    const normalized = this.clean(content).toLowerCase();

    if (!normalized) {
      return false;
    }

    /*
     * Questions and requests for suggestions are not confirmations.
     *
     * Examples:
     * - 这个图片可以怎么设计？
     * - 可以怎样改？
     * - 你觉得这个可以吗？
     *
     * The word "可以" alone is therefore insufficient evidence.
     */
    const questionSignals = [
      '?',
      '？',
      '怎么',
      '怎样',
      '如何',
      '可以吗',
      '行吗',
      '好吗',
      '建议',
      '有什么想法',
      '你觉得',
    ];

    if (questionSignals.some((signal) => normalized.includes(signal))) {
      return false;
    }

    /*
     * Strong explicit confirmation phrases.
     */
    const strongConfirmationSignals = [
      '以这个为准',
      '就用这个',
      '就这样',
      '就是这个',
      '这个可以',
      '这样可以',
      '确认',
      '确定',
      '没错',
      '对，就是',
      '记住',
      '以后使用',
      '之后使用',
      '以后就',
      '之后就',
      '定这个',
      '采用这个',
      '按这个',
      '照这个',
      'this is right',
      'use this',
      'confirmed',
      'exactly',
    ];

    return strongConfirmationSignals.some((signal) =>
      normalized.includes(signal),
    );
  }

  private clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 1200);
  }

  private isUser(role: string): boolean {
    return role.toUpperCase() === 'USER';
  }

  private hasSignal(content: string, signals: string[]): boolean {
    const normalized = content.toLowerCase();

    return signals.some((signal) => normalized.includes(signal.toLowerCase()));
  }
}
