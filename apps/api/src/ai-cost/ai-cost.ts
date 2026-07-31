export type AiModelPricing = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
};

export type CalculateAiCostInput = {
  model: string;
  promptTokens: number;
  cachedInputTokens: number;
  completionTokens: number;
  usdToMyrRate: number;
};

export type CalculateAiCostResult = {
  regularInputTokens: number;
  estimatedCostUsd: number;
  estimatedCostMyr: number;
  pricing: AiModelPricing;
  pricingMatched: boolean;
};

const MODEL_PRICING: Array<{
  matches: (model: string) => boolean;
  pricing: AiModelPricing;
}> = [
  {
    matches: (model) => model.startsWith('gpt-5.6-luna'),
    pricing: {
      inputPerMillion: 1,
      cachedInputPerMillion: 0.1,
      outputPerMillion: 6,
    },
  },
];

export function getAiModelPricing(model: string): {
  pricing: AiModelPricing;
  matched: boolean;
} {
  const configuration = MODEL_PRICING.find((item) => item.matches(model));

  if (configuration) {
    return {
      pricing: configuration.pricing,
      matched: true,
    };
  }

  return {
    pricing: {
      inputPerMillion: 0,
      cachedInputPerMillion: 0,
      outputPerMillion: 0,
    },
    matched: false,
  };
}

export function calculateAiCost(
  input: CalculateAiCostInput,
): CalculateAiCostResult {
  const promptTokens = Math.max(0, Math.round(input.promptTokens));

  const cachedInputTokens = Math.min(
    promptTokens,
    Math.max(0, Math.round(input.cachedInputTokens)),
  );

  const completionTokens = Math.max(0, Math.round(input.completionTokens));

  const usdToMyrRate =
    Number.isFinite(input.usdToMyrRate) && input.usdToMyrRate > 0
      ? input.usdToMyrRate
      : 4.3;

  const { pricing, matched } = getAiModelPricing(input.model);

  const regularInputTokens = Math.max(0, promptTokens - cachedInputTokens);

  const estimatedCostUsd =
    (regularInputTokens * pricing.inputPerMillion +
      cachedInputTokens * pricing.cachedInputPerMillion +
      completionTokens * pricing.outputPerMillion) /
    1_000_000;

  return {
    regularInputTokens,
    estimatedCostUsd,
    estimatedCostMyr: estimatedCostUsd * usdToMyrRate,
    pricing,
    pricingMatched: matched,
  };
}
