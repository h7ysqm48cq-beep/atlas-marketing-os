import { ConversationMemoryService } from './conversation-memory.service';

describe('ConversationMemoryService generated images', () => {
  it('returns an existing message when the same image job is persisted twice', async () => {
    const existingMessage = {
      id: 'message-1',
      content: 'Generated image',
      metadata: {
        sourceJobId: 'job-1',
      },
    };
    const prisma = {
      copilotConversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conversation-1',
          campaignId: null,
          title: 'Conversation',
          mode: 'chat',
          updatedAt: new Date(),
          _count: { messages: 1 },
        }),
      },
      copilotConversationMessage: {
        findFirst: jest.fn().mockResolvedValue(existingMessage),
      },
    };
    const service = new ConversationMemoryService(
      prisma as never,
      {
        getActiveBrand: jest.fn().mockResolvedValue({ id: 'brand-1' }),
      } as never,
      {} as never,
    );
    const append = jest.spyOn(service, 'appendAssistantMessage');

    await expect(
      service.appendGeneratedImage('conversation-1', {
        imageUrl: 'https://example.com/image.png',
        sourceJobId: 'job-1',
      }),
    ).resolves.toBe(existingMessage);

    expect(prisma.copilotConversationMessage.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: 'conversation-1',
        metadata: {
          path: ['sourceJobId'],
          equals: 'job-1',
        },
      },
    });
    expect(append).not.toHaveBeenCalled();
  });
});
