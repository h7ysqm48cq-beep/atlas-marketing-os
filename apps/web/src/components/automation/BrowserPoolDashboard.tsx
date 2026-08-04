"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  API_URL,
} from "@/lib/api";
import styles from "./BrowserPoolDashboard.module.css";

type PoolAccount = {
  id: string;
  displayName: string;
  platform: string;
  browserProfileKey: string;
  browserProfileName: string;
  locale: string;
  timezone: string;
  proxyType: string;
  proxyCountry: string | null;
  lastKnownIp: string | null;
  loginStatus: string;
  cookieStatus: string;
  lastLoginAt: string | null;
  lastVerifiedAt: string | null;
  lastHeartbeatAt: string | null;
  heartbeatAgeSeconds: number | null;
  lastLoginError: string | null;
  pageCount: number;
  pages: Array<{
    id: string;
    name: string;
    platform: string;
    status: string;
    externalId: string | null;
    username: string | null;
    isPrimary: boolean;
  }>;
  health: {
    score: number;
    status:
      | "HEALTHY"
      | "WARNING"
      | "CRITICAL"
      | string;
    warnings: string[];
  };
  availability:
    | "AVAILABLE"
    | "ATTENTION"
    | "LOGIN_REQUIRED"
    | string;
};

type PoolResponse = {
  summary: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    available: number;
    loginRequired: number;
  };
  accounts: PoolAccount[];
  generatedAt: string;
};

function formatDate(
  value: string | null,
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "en-MY",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

function heartbeatLabel(
  seconds: number | null,
) {
  if (seconds === null) {
    return "No heartbeat";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  if (seconds < 3600) {
    return `${Math.floor(
      seconds / 60,
    )}m ago`;
  }

  if (seconds < 86400) {
    return `${Math.floor(
      seconds / 3600,
    )}h ago`;
  }

  return `${Math.floor(
    seconds / 86400,
  )}d ago`;
}

export function BrowserPoolDashboard() {
  const [
    data,
    setData,
  ] = useState<PoolResponse | null>(
    null,
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    search,
    setSearch,
  ] = useState("");

  const load =
    useCallback(
      async () => {
        setLoading(true);
        setError("");

        try {
          const response =
            await fetch(
              `${API_URL}/browser-runtime/accounts/pool/overview`,
              {
                cache:
                  "no-store",
              },
            );

          const text =
            await response.text();

          const body =
            text
              ? JSON.parse(
                  text,
                )
              : {};

          if (!response.ok) {
            throw new Error(
              typeof body.message ===
                "string"
                ? body.message
                : "Unable to load Browser Pool.",
            );
          }

          setData(
            body as PoolResponse,
          );
        } catch (loadError) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Unable to load Browser Pool.",
          );
        } finally {
          setLoading(false);
        }
      },
      [],
    );

  useEffect(() => {
    void load();
  }, [
    load,
  ]);

  const accounts =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return (
          data?.accounts ||
          []
        );
      }

      return (
        data?.accounts ||
        []
      ).filter(
        (account) =>
          [
            account.displayName,
            account.browserProfileName,
            account.lastKnownIp,
            account.proxyCountry,
            account.loginStatus,
            account.cookieStatus,
            account.health.status,
            ...account.pages.map(
              (page) =>
                page.name,
            ),
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(
                  query,
                ),
            ),
      );
    }, [
      data,
      search,
    ]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            Browser Runtime
          </p>

          <h1>
            Browser Pool
          </h1>

          <p>
            Monitor browser availability,
            account health, cookies, proxies
            and managed Facebook Pages.
          </p>
        </div>

        <div className={styles.headerActions}>
          <a
            className={styles.secondaryButton}
            href="/automation/browser-accounts"
          >
            Manage Accounts
          </a>

          <button
            className={styles.primaryButton}
            type="button"
            disabled={loading}
            onClick={() =>
              void load()
            }
          >
            {loading
              ? "Refreshing…"
              : "Refresh Pool"}
          </button>
        </div>
      </header>

      {error ? (
        <div className={styles.error}>
          {error}
        </div>
      ) : null}

      <section className={styles.summary}>
        <article>
          <span>
            Total Browsers
          </span>
          <strong>
            {data?.summary.total || 0}
          </strong>
        </article>

        <article>
          <span>
            Healthy
          </span>
          <strong>
            {data?.summary.healthy || 0}
          </strong>
        </article>

        <article>
          <span>
            Available
          </span>
          <strong>
            {data?.summary.available || 0}
          </strong>
        </article>

        <article>
          <span>
            Warning
          </span>
          <strong>
            {data?.summary.warning || 0}
          </strong>
        </article>

        <article>
          <span>
            Login Required
          </span>
          <strong>
            {data?.summary.loginRequired || 0}
          </strong>
        </article>
      </section>

      <section className={styles.toolbar}>
        <input
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value,
            )
          }
          placeholder="Search browser, Page, IP or status…"
        />

        <span>
          {accounts.length} browser(s)
        </span>
      </section>

      <section className={styles.tableWrap}>
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Browser</span>
            <span>Health</span>
            <span>Login</span>
            <span>Cookie</span>
            <span>Proxy / IP</span>
            <span>Pages</span>
            <span>Heartbeat</span>
            <span>Action</span>
          </div>

          {loading &&
          !data ? (
            <div className={styles.empty}>
              Loading Browser Pool…
            </div>
          ) : null}

          {!loading &&
          !accounts.length ? (
            <div className={styles.empty}>
              No Browser Accounts found.
            </div>
          ) : null}

          {accounts.map(
            (account) => (
              <div
                className={styles.tableRow}
                key={account.id}
              >
                <span className={styles.browserCell}>
                  <strong>
                    {account.displayName}
                  </strong>

                  <small>
                    {account.browserProfileName}
                  </small>
                </span>

                <span>
                  <b
                    className={
                      account.health.status ===
                      "HEALTHY"
                        ? styles.good
                        : account.health.status ===
                            "WARNING"
                          ? styles.warning
                          : styles.bad
                    }
                  >
                    {account.health.score}
                  </b>

                  <small>
                    {account.health.status}
                  </small>
                </span>

                <span>
                  <strong>
                    {account.loginStatus.replaceAll(
                      "_",
                      " ",
                    )}
                  </strong>

                  <small>
                    {account.availability.replaceAll(
                      "_",
                      " ",
                    )}
                  </small>
                </span>

                <span>
                  <strong>
                    {account.cookieStatus.replaceAll(
                      "_",
                      " ",
                    )}
                  </strong>

                  <small>
                    Verified{" "}
                    {formatDate(
                      account.lastVerifiedAt,
                    )}
                  </small>
                </span>

                <span>
                  <strong>
                    {account.proxyType}
                    {account.proxyCountry
                      ? ` · ${account.proxyCountry}`
                      : ""}
                  </strong>

                  <small>
                    {account.lastKnownIp ||
                      "IP not checked"}
                  </small>
                </span>

                <span>
                  <strong>
                    {account.pageCount}
                  </strong>

                  <small>
                    {account.pages
                      .slice(0, 2)
                      .map(
                        (page) =>
                          page.name,
                      )
                      .join(", ") ||
                      "No Pages"}
                  </small>
                </span>

                <span>
                  <strong>
                    {heartbeatLabel(
                      account.heartbeatAgeSeconds,
                    )}
                  </strong>

                  <small>
                    {formatDate(
                      account.lastHeartbeatAt,
                    )}
                  </small>
                </span>

                <span>
                  <a
                    className={styles.viewLink}
                    href={`/automation/browser-accounts?accountId=${encodeURIComponent(
                      account.id,
                    )}`}
                  >
                    View
                  </a>
                </span>
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
