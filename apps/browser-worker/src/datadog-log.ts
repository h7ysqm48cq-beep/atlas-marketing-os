function sendDatadogLog(level: 'debug' | 'info' | 'warn' | 'error', message: string) {
  const apiKey = process.env.DD_API_KEY?.trim();
  if (!apiKey) return;
  const site = process.env.DD_SITE?.trim() || 'datadoghq.com';
  const service = process.env.DD_SERVICE?.trim() || 'atlas-browser-worker';
  const env = process.env.DD_ENV?.trim() || process.env.NODE_ENV || 'production';
  void fetch(`https://http-intake.logs.${site}/api/v2/logs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'DD-API-KEY': apiKey },
    body: JSON.stringify([{ message, service, ddsource: 'nodejs', ddtags: `env:${env}`, status: level }]),
  }).catch(() => undefined);
}

export function installDatadogConsoleLogging() {
  for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      sendDatadogLog(level === 'log' ? 'info' : level, args.map(String).join(' '));
    };
  }
}
