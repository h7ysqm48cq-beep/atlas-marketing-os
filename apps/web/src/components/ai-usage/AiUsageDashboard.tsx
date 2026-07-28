"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import styles from "./AiUsageDashboard.module.css";

import { API_URL } from '@/lib/api';
type UsageTotals = {
  calls: number;
  promptTokens: number;
  cachedInputTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostMyr: number;
  averageDurationMs: number;
};

type ModelUsage = UsageTotals & {
  model: string;
  totalDurationMs: number;
};

type SummaryResponse = {
  period: {
    days: number;
    from: string;
    to: string;
  };
  today: UsageTotals;
  last24Hours: UsageTotals;
  totals: UsageTotals & {
    totalDurationMs: number;
    averagePromptTokens: number;
    averageCompletionTokens: number;
    averageTotalTokens: number;
    cacheRatePercent: number;
    averageCostPerCallMyr: number;
    averageCostPerCallUsd: number;
    averageDailyCostMyr: number;
    averageDailyCostUsd: number;
    projectedMonthlyCostMyr: number;
    projectedMonthlyCostUsd: number;
  };
  models: ModelUsage[];
};

type RecentUsage = {
  id: string;
  model: string;
  promptTokens: number;
  cachedInputTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostMyr: number;
  durationMs: number;
  createdAt: string;
  history: {
    topic: string;
    platforms: string[];
    style: string;
    language: string;
    brand: {
      id: string;
      name: string;
    };
    campaign: {
      id: string;
      name: string;
    } | null;
  } | null;
};

type TrendUsage = {
  date: string;
  calls: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostMyr: number;
  averageDurationMs: number;
};

function number(value: number) {
  return new Intl.NumberFormat("en-MY").format(value);
}

function myr(value: number) {
  return `RM ${value.toFixed(4)}`;
}

function usd(value: number) {
  return `$${value.toFixed(6)}`;
}

function duration(value: number) {
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} s`
    : `${Math.round(value)} ms`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AiUsageDashboard() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] =
    useState<SummaryResponse | null>(null);
  const [recent, setRecent] =
    useState<RecentUsage[]>([]);
  const [trend, setTrend] =
    useState<TrendUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [summaryRes, recentRes, trendRes] =
        await Promise.all([
          fetch(
            `${API_URL}/ai-usage/summary?days=${days}`,
            { cache: "no-store" },
          ),
          fetch(
            `${API_URL}/ai-usage/recent?limit=20`,
            { cache: "no-store" },
          ),
          fetch(
            `${API_URL}/ai-usage/trend?days=${days}`,
            { cache: "no-store" },
          ),
        ]);

      if (
        !summaryRes.ok ||
        !recentRes.ok ||
        !trendRes.ok
      ) {
        throw new Error(
          "Unable to load AI usage data.",
        );
      }

      const [summaryData, recentData, trendData] =
        await Promise.all([
          summaryRes.json() as Promise<SummaryResponse>,
          recentRes.json() as Promise<RecentUsage[]>,
          trendRes.json() as Promise<TrendUsage[]>,
        ]);

      setSummary(summaryData);
      setRecent(recentData);
      setTrend(trendData);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxTrendCost = useMemo(
    () =>
      Math.max(
        ...trend.map(
          (item) => item.estimatedCostMyr,
        ),
        0.000001,
      ),
    [trend],
  );

  if (loading && !summary) {
    return (
      <div className={styles.state}>
        Loading AI usage dashboard...
      </div>
    );
  }

  if (!summary) {
    return (
      <div className={styles.state}>
        <p>{error || "No usage data available."}</p>

        <button onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={styles.dashboard}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            Analytics
          </p>

          <h1>AI Usage Dashboard</h1>

          <p>
            Monitor AI calls, tokens, costs and
            response performance.
          </p>
        </div>

        <div className={styles.actions}>
          <select
            value={days}
            onChange={(event) =>
              setDays(Number(event.target.value))
            }
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>
              Last 365 days
            </option>
          </select>

          <button
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {error ? (
        <div className={styles.error}>
          {error}
        </div>
      ) : null}

      <section className={styles.kpis}>
        <article>
          <span>Requests · last 24h</span>
          <strong>
            {number(summary.last24Hours.calls)}
          </strong>
          <small>
            {number(summary.totals.calls)} in selected period
          </small>
        </article>

        <article>
          <span>Tokens · last 24h</span>
          <strong>
            {number(summary.last24Hours.totalTokens)}
          </strong>
          <small>
            {number(summary.totals.totalTokens)} period total
          </small>
        </article>

        <article>
          <span>Cost · last 24h</span>
          <strong>
            {myr(
              summary.last24Hours.estimatedCostMyr,
            )}
          </strong>
          <small>
            {usd(
              summary.last24Hours.estimatedCostUsd,
            )}
          </small>
        </article>

        <article>
          <span>Average response · 24h</span>
          <strong>
            {duration(
              summary.last24Hours.averageDurationMs,
            )}
          </strong>
          <small>
            {duration(
              summary.totals.averageDurationMs,
            )} period average
          </small>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>
                Cost trend
              </p>
              <h2>Daily MYR spending</h2>
            </div>

            <strong>
              {myr(
                summary.totals.estimatedCostMyr,
              )}
            </strong>
          </header>

          <div className={styles.bars}>
            {trend.length ? (
              trend.map((item) => {
                const height =
                  Math.max(
                    4,
                    item.estimatedCostMyr /
                      maxTrendCost *
                      100,
                  );

                return (
                  <div
                    className={styles.barItem}
                    key={item.date}
                    title={`${item.date}: ${myr(
                      item.estimatedCostMyr,
                    )}`}
                  >
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{
                          height: `${height}%`,
                        }}
                      />
                    </div>

                    <span>
                      {item.date.slice(5)}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className={styles.empty}>
                No trend data yet.
              </p>
            )}
          </div>
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>
                Models
              </p>
              <h2>Usage by model</h2>
            </div>
          </header>

          <div className={styles.models}>
            {summary.models.map((item) => {
              const percentage =
                summary.totals.calls > 0
                  ? item.calls /
                    summary.totals.calls *
                    100
                  : 0;

              return (
                <div
                  className={styles.model}
                  key={item.model}
                >
                  <div>
                    <strong>{item.model}</strong>
                    <span>
                      {item.calls} calls ·{" "}
                      {myr(item.estimatedCostMyr)}
                    </span>
                  </div>

                  <b>
                    {percentage.toFixed(0)}%
                  </b>

                  <div className={styles.progress}>
                    <div
                      style={{
                        width: `${percentage}%`,
                      }}
                    />
                  </div>

                  <small>
                    {number(item.totalTokens)} tokens ·{" "}
                    {duration(
                      item.averageDurationMs,
                    )} avg
                  </small>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className={styles.gridSmall}>
        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>
                Tokens
              </p>
              <h2>Efficiency details</h2>
            </div>
          </header>

          <div className={styles.details}>
            <div>
              <span>Prompt</span>
              <strong>
                {number(
                  summary.totals.promptTokens,
                )}
              </strong>
            </div>

            <div>
              <span>Completion</span>
              <strong>
                {number(
                  summary.totals.completionTokens,
                )}
              </strong>
            </div>

            <div>
              <span>Cached</span>
              <strong>
                {number(
                  summary.totals.cachedInputTokens,
                )}
              </strong>
            </div>

            <div>
              <span>Cache rate</span>
              <strong>
                {summary.totals.cacheRatePercent.toFixed(
                  2,
                )}
                %
              </strong>
            </div>
          </div>
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>
                Total cost
              </p>
              <h2>{days}-day period</h2>
            </div>
          </header>

          <div className={styles.cost}>
            <strong>
              {myr(
                summary.totals.estimatedCostMyr,
              )}
            </strong>

            <span>
              {usd(
                summary.totals.estimatedCostUsd,
              )}
            </span>

            <div className={styles.costMetrics}>
              <div>
                <small>Average per call</small>
                <b>
                  {myr(
                    summary.totals
                      .averageCostPerCallMyr,
                  )}
                </b>
              </div>

              <div>
                <small>Monthly forecast</small>
                <b>
                  {myr(
                    summary.totals
                      .projectedMonthlyCostMyr,
                  )}
                </b>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <header>
          <div>
            <p className={styles.eyebrow}>
              Activity
            </p>
            <h2>Recent AI requests</h2>
          </div>

          <strong>{recent.length}</strong>
        </header>

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Topic</th>
                <th>Model</th>
                <th>Platform</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Duration</th>
                <th>Created</th>
              </tr>
            </thead>

            <tbody>
              {recent.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className={styles.topic}>
                      <strong>
                        {item.history?.topic ||
                          "Unknown request"}
                      </strong>

                      <span>
                        {item.history?.brand.name ||
                          "No brand"}
                      </span>
                    </div>
                  </td>

                  <td>
                    <span className={styles.badge}>
                      {item.model}
                    </span>
                  </td>

                  <td>
                    {item.history?.platforms.join(
                      ", ",
                    ) || "—"}
                  </td>

                  <td>
                    {number(item.totalTokens)}
                  </td>

                  <td>
                    {myr(item.estimatedCostMyr)}
                  </td>

                  <td>
                    {duration(item.durationMs)}
                  </td>

                  <td>
                    {dateTime(item.createdAt)}
                  </td>
                </tr>
              ))}

              {!recent.length ? (
                <tr>
                  <td
                    className={styles.empty}
                    colSpan={7}
                  >
                    No requests recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
