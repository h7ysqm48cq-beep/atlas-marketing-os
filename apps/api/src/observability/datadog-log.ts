export type DatadogLogLevel = 'debug' | 'info' | 'warn' | 'error';

export function datadogLogPayload(service: string, env: string, level: DatadogLogLevel, message: string) {
  return { message, service, ddsource: 'nodejs', ddtags: `env:${env}`, status: level };
}

export function sendDatadogLog(level: DatadogLogLevel, message: string) {
  const apiKey = process.env.DD_API_KEY?.trim();
  if (!apiKey) return;
  const site = process.env.DD_SITE?.trim() || 'datadoghq.com';
  const service = process.env.DD_SERVICE?.trim() || 'atlas-api';
  const env = process.env.DD_ENV?.trim() || process.env.NODE_ENV || 'production';
  void fetch(`https://http-intake.logs.${site}/api/v2/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'DD-API-KEY': apiKey },
    body: JSON.stringify([datadogLogPayload(service, env, level, message)]),
  }).catch(() => undefined);
}
