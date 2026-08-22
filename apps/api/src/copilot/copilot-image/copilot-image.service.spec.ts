import { GenerateAssetImageDto } from '../../asset-image/dto/generate-asset-image.dto';
import { ImagePromptEngineService } from '../../image-prompt-engine/image-prompt-engine.service';
import { CopilotImageService } from './copilot-image.service';

describe('CopilotImageService', () => {
  let queuedPayload: GenerateAssetImageDto | undefined;
  const generateAndSave = jest.fn();
  const enqueue = jest.fn((payload: GenerateAssetImageDto) => {
    queuedPayload = payload;
    return Promise.resolve({ id: 'job-1' });
  });

  const createService = (executionMode = 'background') =>
    new CopilotImageService(
      { enqueue } as never,
      { generateAndSave } as never,
      {
        get: jest.fn((key: string) =>
          key === 'COPILOT_IMAGE_EXECUTION_MODE' ? executionMode : undefined,
        ),
      } as never,
      new ImagePromptEngineService(),
    );

  beforeEach(() => {
    queuedPayload = undefined;
    enqueue.mockReset();
    generateAndSave.mockReset();
    enqueue.mockImplementation((payload: GenerateAssetImageDto) => {
      queuedPayload = payload;
      return Promise.resolve({ id: 'job-1' });
    });
  });

  it('keeps internal asset metadata out of the generated pixels', async () => {
    const service = createService();

    await service.generate({
      content: 'A warm Malaysian community scene',
      platform: 'Facebook',
      conversationId: 'conversation-1',
      messageIndex: 4,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Atlas Copilot image',
        textOverlayMode: 'AUTO',
        aspectRatio: '1:1',
        conversationId: 'conversation-1',
        messageIndex: 4,
      }),
    );
    expect(queuedPayload?.prompt).toContain(
      'Do not render any logo, brand name, website, signature, or watermark.',
    );
    expect(queuedPayload?.prompt).toContain('Aspect ratio: 1:1');
    expect(queuedPayload?.prompt).not.toContain('copilot-generated-image');
  });

  it('turns direct chat instructions into per-image branding and resolution overrides', async () => {
    const service = createService();

    await service.generate({
      content: 'Create the campaign visual.',
      instructions:
        '生成 1920×1080，右上角 Logo，Logo透明度 80%，文字叠加「今晚全力出击」，页脚文字「满贯门」',
      platform: 'Facebook',
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        outputWidth: 1920,
        outputHeight: 1080,
        logoMode: 'ALWAYS',
        logoPlacement: 'TOP_RIGHT',
        logoOpacity: 0.8,
        textOverlayMode: 'ALWAYS',
        textOverlayText: '今晚全力出击',
        brandFooterMode: 'ALWAYS',
        footerText: '满贯门',
      }),
    );
    expect(queuedPayload?.prompt).toContain('Aspect ratio: 1920:1080');
  });

  it('generates in the current process when direct execution is enabled', async () => {
    generateAndSave.mockResolvedValue({
      asset: {
        id: 'asset-1',
        url: 'https://example.com/generated.png',
      },
      generation: {
        brandFooterEnabled: true,
        footerLogoEnabled: true,
        cornerLogoEnabled: false,
      },
    });
    const service = createService('direct');

    const result = await service.generate({
      content: 'A direct local image',
      conversationId: 'conversation-1',
      messageIndex: 2,
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(generateAndSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Atlas Copilot image',
        conversationId: 'conversation-1',
        messageIndex: 2,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'direct-asset-1',
        status: 'SUCCEEDED',
        attempts: 1,
        result: expect.objectContaining({
          asset: expect.objectContaining({ id: 'asset-1' }),
        }),
      }),
    );
  });

  it('defaults to direct execution outside production', async () => {
    generateAndSave.mockResolvedValue({
      asset: { id: 'asset-2', url: 'https://example.com/local.png' },
    });
    const service = new CopilotImageService(
      { enqueue } as never,
      { generateAndSave } as never,
      { get: jest.fn(() => undefined) } as never,
      new ImagePromptEngineService(),
    );

    await service.generate({ content: 'Local image' });

    expect(generateAndSave).toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
