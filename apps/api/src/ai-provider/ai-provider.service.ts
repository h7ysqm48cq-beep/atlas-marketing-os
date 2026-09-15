import { Injectable } from '@nestjs/common';
import { AiRuntimeSettingsService } from '../ai-runtime/ai-runtime-settings.service';
import { OpenAiProvider } from './openai.provider';
import { GoogleAiStudioProvider } from './google-ai-studio.provider';
import { MiniMaxProvider } from './minimax.provider';
import type {
  AiProvider,
  AiProviderName,
  AiProviderOptions,
  AiProviderPrompt,
  AiProviderResult,
} from './ai-provider.types';

type RoutingCandidate = {
  provider: AiProviderName;
  model: string;
  enabled: boolean;
};

type RoutingSettings = {
  mode: 'AUTO' | 'MANUAL';
  fallbackEnabled: boolean;
  automaticRecoveryEnabled: boolean;
  timeoutMs: number;
  cooldownMs: number;
  manualProvider: AiProviderName;
  manualModel: string;
  candidates: RoutingCandidate[];
};

@Injectable()
export class AiProviderService {
  constructor(
    private readonly openAiProvider: OpenAiProvider,
    private readonly googleAiStudioProvider: GoogleAiStudioProvider,
    private readonly minimaxProvider: MiniMaxProvider,
    private readonly aiRuntime: AiRuntimeSettingsService,
  ) {}

  async generate(
    prompt: AiProviderPrompt,
    options: AiProviderOptions = {},
  ): Promise<AiProviderResult> {
    if (options.provider) {
      return this.providerFor(options.provider).generate(prompt, options);
    }

    const settings = await this.aiRuntime.getAiRoutingSettings();
    const candidates = this.resolveCandidates(settings as RoutingSettings);
    let lastError: unknown;
    let firstFailureReason: string | undefined;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];

      try {
        const output = await this.providerFor(candidate.provider).generate(prompt, {
          ...options,
          provider: candidate.provider,
          model: candidate.model,
        });

        return {
          ...output,
          routing: {
            requestedProvider: candidates[0].provider,
            requestedModel: candidates[0].model,
            usedProvider: output.provider,
            usedModel: output.model,
            fallback: index > 0,
            ...(index > 0 && firstFailureReason
              ? { fallbackReason: firstFailureReason }
              : {}),
          },
        };
      } catch (error) {
        lastError = error;
        firstFailureReason ??= this.errorReason(error);

        if (!settings.fallbackEnabled || !this.isFallbackEligible(error)) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('No AI provider is available.');
  }

  private resolveCandidates(settings: RoutingSettings): RoutingCandidate[] {
    const enabled = settings.candidates.filter((candidate) => candidate.enabled);

    if (settings.mode === 'AUTO') {
      return enabled;
    }

    const manual: RoutingCandidate = {
      provider: settings.manualProvider,
      model: settings.manualModel,
      enabled: true,
    };

    if (!settings.fallbackEnabled) {
      return [manual];
    }

    return [
      manual,
      ...enabled.filter(
        (candidate) =>
          candidate.provider !== manual.provider || candidate.model !== manual.model,
      ),
    ];
  }

  private providerFor(provider: AiProviderName): AiProvider {
    if (provider === 'google') {
      return this.googleAiStudioProvider;
    }
    if (provider === 'minimax') {
      return this.minimaxProvider;
    }
    return this.openAiProvider;
  }

  private isFallbackEligible(error: unknown): boolean {
    const value = error as { status?: number; getStatus?: () => number };
    const status =
      typeof value?.status === 'number'
        ? value.status
        : typeof value?.getStatus === 'function'
          ? value.getStatus()
          : undefined;

    if (status === 401 || status === 403 || status === 408 || status === 429) {
      return true;
    }
    if (typeof status === 'number' && status >= 500) {
      return true;
    }

    const message = this.errorReason(error).toLowerCase();
    if (status === 400) {
      return /quota|credit|balance|token.*limit|rate.?limit/.test(message);
    }

    return /quota|credit|balance|rate.?limit|timeout|timed out|network|fetch failed|econn|temporar|unavailable|not configured/.test(
      message,
    );
  }

  private errorReason(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return 'provider_error';
  }
}
