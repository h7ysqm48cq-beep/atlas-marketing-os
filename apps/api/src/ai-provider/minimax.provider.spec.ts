import { MiniMaxProvider } from './minimax.provider';

const prompt = { system: 'You are Atlas.', user: 'Write one line.' };

function config(values: Record<string, string | undefined>) {
  return { get: jest.fn((key: string) => values[key]) };
}

describe('MiniMaxProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('calls OpenAI-compatible chat endpoint and maps usage', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'MiniMax-M3',
        choices: [{ message: { content: 'Hello from M3' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = new (MiniMaxProvider as any)(
      config({
        MINIMAX_API_KEY: 'test-key',
        MINIMAX_BASE_URL: 'https://api.minimax.io/v1',
        MINIMAX_MODEL: 'MiniMax-M3',
      }),
    );

    const output = await provider.generate(prompt, {
      maxOutputTokens: 256,
      temperature: 0.7,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.minimax.io/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'MiniMax-M3',
      max_completion_tokens: 256,
      temperature: 0.7,
    });
    expect(output).toMatchObject({
      provider: 'minimax',
      model: 'MiniMax-M3',
      text: 'Hello from M3',
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    });
  });

  test('fails clearly when API key is missing', async () => {
    const provider = new (MiniMaxProvider as any)(config({}));
    await expect(provider.generate(prompt)).rejects.toThrow(
      'MINIMAX_API_KEY is not configured.',
    );
  });

  test('preserves HTTP status for routing decisions', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ base_resp: { status_code: 1008 } }),
    }) as typeof fetch;
    const provider = new (MiniMaxProvider as any)(
      config({ MINIMAX_API_KEY: 'test-key' }),
    );

    await expect(provider.generate(prompt)).rejects.toMatchObject({
      status: 429,
      message: 'MiniMax request failed with HTTP 429.',
    });
  });
});
