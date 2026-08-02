export type BackgroundJob<T> = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  result: T | null;
  error: string | null;
};

export async function waitForBackgroundJob<T>(
  url: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(url, { cache: "no-store" });
    const job = (await response.json()) as BackgroundJob<T> & {
      message?: string;
    };

    if (!response.ok) {
      throw new Error(job.message || "Unable to read background task.");
    }
    if (job.status === "SUCCEEDED" && job.result) return job.result;
    if (job.status === "FAILED") {
      throw new Error(job.error || "Background task failed.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }

  throw new Error("Background task is still running. Refresh to check again.");
}
