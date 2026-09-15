import { AiProviderService } from './ai-provider.service';

const prompt = { system: 'You are Atlas.', user: 'Create a short post.' };

function result(provider: 'openai' | 'google' | 'minimax', model: string) {
  return {
    provider,
    model,
    text: `${provider}:${model}`,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    durationMs: 5,
  };
}

function provider(name: string) {
  return { name, generate: jest.fn() };
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    getAiRoutingSettings: jest.fn().mockResolvedValue({
      mode: 'AUTO',
      fallbackEnabled: true,
      automaticRecoveryEnabled: true,
      timeoutMs: 30000,
      cooldownMs: 300000,
      manualProvider: 'minimax',
      manualModel: 'MiniMax-M3',
      candidates: [
        { provider: 'minimax', model: 'MiniMax-M3', enabled: true },
        { provider: 'openai', model: 'gpt-5.6-luna', enabled: true },
        { provider: 'google', model: 'gemini-3.6-flash', enabled: true },
      ],
      ...overrides,
    }),
  };
}

describe('AiProviderService routing', () => {
  test('routes an explicit MiniMax request to MiniMax', async () => {
    const openai = provider('openai');
    const google = provider('google');
    const minimax = provider('minimax');
    minimax.generate.mockResolvedValue(result('minimax', 'MiniMax-M3'));
    const service = new (AiProviderService as any)(openai, google, minimax, runtime());

    const output = await service.generate(prompt, { provider: 'minimax', model: 'MiniMax-M3' });

    expect(output.provider).toBe('minimax');
    expect(minimax.generate).toHaveBeenCalledTimes(1);
    expect(openai.generate).not.toHaveBeenCalled();
    expect(google.generate).not.toHaveBeenCalled();
  });

  test('falls back in configured order when primary is unavailable', async () => {
    const openai = provider('openai');
    const google = provider('google');
    const minimax = provider('minimax');
    minimax.generate.mockRejectedValue(Object.assign(new Error('rate_limit'), { status: 429 }));
    openai.generate.mockResolvedValue(result('openai', 'gpt-5.6-luna'));
    const service = new (AiProviderService as any)(openai, google, minimax, runtime());

    const output = await service.generate(prompt);

    expect(minimax.generate).toHaveBeenCalledTimes(1);
    expect(openai.generate).toHaveBeenCalledTimes(1);
    expect(google.generate).not.toHaveBeenCalled();
    expect(output.routing).toMatchObject({
      requestedProvider: 'minimax',
      requestedModel: 'MiniMax-M3',
      usedProvider: 'openai',
      usedModel: 'gpt-5.6-luna',
      fallback: true,
      fallbackReason: 'rate_limit',
    });
  });

  test('manual-only mode surfaces selected provider error', async () => {
    const openai = provider('openai');
    const google = provider('google');
    const minimax = provider('minimax');
    minimax.generate.mockRejectedValue(new Error('quota_exhausted'));
    const service = new (AiProviderService as any)(
      openai,
      google,
      minimax,
      runtime({ mode: 'MANUAL', fallbackEnabled: false }),
    );

    await expect(service.generate(prompt)).rejects.toThrow('quota_exhausted');
    expect(openai.generate).not.toHaveBeenCalled();
    expect(google.generate).not.toHaveBeenCalled();
  });

  test('does not fallback on a non-retriable 400 request error', async () => {
    const openai = provider('openai');
    const google = provider('google');
    const minimax = provider('minimax');
    minimax.generate.mockRejectedValue(Object.assign(new Error('invalid_request'), { status: 400 }));
    openai.generate.mockResolvedValue(result('openai', 'gpt-5.6-luna'));
    const service = new (AiProviderService as any)(openai, google, minimax, runtime());

    await expect(service.generate(prompt)).rejects.toThrow('invalid_request');
    expect(openai.generate).not.toHaveBeenCalled();
  });
});
