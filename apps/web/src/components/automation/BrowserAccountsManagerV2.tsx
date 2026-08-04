"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_URL } from "@/lib/api";
import styles from "./BrowserAccountsManagerV2.module.css";

type ProxyType =
  | "DIRECT"
  | "HTTP"
  | "HTTPS"
  | "SOCKS5";

type LoginStatus =
  | "PENDING"
  | "BROWSER_OPEN"
  | "BROWSER_CLOSED"
  | "LOGIN_REQUIRED"
  | "LOGGED_IN"
  | "TWO_FACTOR_REQUIRED"
  | "CHECKPOINT_REQUIRED"
  | "UNKNOWN"
  | string;

type BrowserAccount = {
  id: string;
  displayName: string;
  platform: string;
  browserProfileKey: string;
  browserProfileName: string;
  locale: string;
  timezone: string;

  proxyType: ProxyType;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyCountry: string | null;
  hasProxyUsername: boolean;
  hasProxyPassword: boolean;

  facebookUserId: string | null;
  facebookUserName: string | null;

  loginStatus: LoginStatus;
  cookieStatus: string;
  lastKnownIp: string | null;
  lastLoginAt: string | null;
  lastVerifiedAt: string | null;
  lastHeartbeatAt: string | null;
  lastLoginError: string | null;

  channels: unknown[];
  createdAt: string;
  updatedAt: string;
};

type BrowserSession = {
  channelId: string;
  browserProfileKey: string;
  profileDirectory?: string;
  openedAt: string;
  locale: string;
  timezone: string;
  proxyType: ProxyType;
  headless: boolean;
  currentUrl: string | null;
};

type AccountRuntime = {
  loading: boolean;
  running: boolean;
  session: BrowserSession | null;
  error: string;
};

type InspectionResult = {
  loginStatus?: string;
  loginLikely?: boolean;
  loginRequired?: boolean;
  twoFactorRequired?: boolean;
  checkpointRequired?: boolean;
  page?: {
    title?: string;
    url?: string;
  };
};

const EMPTY_RUNTIME: AccountRuntime = {
  loading: false,
  running: false,
  session: null,
  error: "",
};

const NOVNC_URL =
  process.env.NEXT_PUBLIC_BROWSER_VIEW_URL ||
  "https://browser-worker-production-536a.up.railway.app/vnc.html";

async function readJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(
      text,
    ) as Record<string, unknown>;
  } catch {
    return {
      message: text,
    };
  }
}

function getErrorMessage(
  body: Record<string, unknown>,
  fallback: string,
) {
  return typeof body.message ===
    "string" &&
    body.message.trim()
    ? body.message
    : fallback;
}

function formatDate(
  value?: string | null,
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

function normalizeStatus(
  value?: string | null,
) {
  return (
    value?.trim().toUpperCase() ||
    "UNKNOWN"
  );
}

function loginStatusClass(
  status?: string | null,
) {
  const normalized =
    normalizeStatus(status);

  if (
    normalized === "LOGGED_IN"
  ) {
    return styles.good;
  }

  if (
    normalized ===
      "TWO_FACTOR_REQUIRED" ||
    normalized ===
      "CHECKPOINT_REQUIRED"
  ) {
    return styles.warning;
  }

  if (
    normalized ===
      "LOGIN_REQUIRED" ||
    normalized === "FAILED"
  ) {
    return styles.bad;
  }

  return styles.neutral;
}

function readableStatus(
  value?: string | null,
) {
  return normalizeStatus(
    value,
  ).replaceAll(
    "_",
    " ",
  );
}

export function BrowserAccountsManagerV2({
  requestedAccountId,
}: {
  requestedAccountId?: string | null;
}) {
  const [
    accounts,
    setAccounts,
  ] = useState<
    BrowserAccount[]
  >([]);

  const [
    runtimes,
    setRuntimes,
  ] = useState<
    Record<
      string,
      AccountRuntime
    >
  >({});

  const [
    selectedId,
    setSelectedId,
  ] = useState<
    string | null
  >(null);

  const [
    selectedForBatch,
    setSelectedForBatch,
  ] = useState<
    Set<string>
  >(new Set());

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    globalError,
    setGlobalError,
  ] = useState("");

  const [
    actionMessage,
    setActionMessage,
  ] = useState("");

  const selectedAccount =
    accounts.find(
      (account) =>
        account.id ===
        selectedId,
    ) || null;

  const selectedRuntime =
    selectedId
      ? runtimes[selectedId] ||
        EMPTY_RUNTIME
      : EMPTY_RUNTIME;

  const filteredAccounts =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return accounts;
      }

      return accounts.filter(
        (account) =>
          [
            account.displayName,
            account.facebookUserName,
            account.browserProfileName,
            account.browserProfileKey,
            account.proxyCountry,
            account.lastKnownIp,
            account.loginStatus,
            account.cookieStatus,
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
      accounts,
      search,
    ]);

  const updateRuntime =
    useCallback(
      (
        accountId: string,
        patch:
          Partial<AccountRuntime>,
      ) => {
        setRuntimes(
          (current) => ({
            ...current,
            [accountId]: {
              ...(current[
                accountId
              ] ||
                EMPTY_RUNTIME),
              ...patch,
            },
          }),
        );
      },
      [],
    );

  const loadRuntime =
    useCallback(
      async (
        accountId: string,
      ) => {
        updateRuntime(
          accountId,
          {
            loading: true,
            error: "",
          },
        );

        try {
          const response =
            await fetch(
              `${API_URL}/browser-runtime/accounts/${accountId}/browser/status`,
              {
                cache:
                  "no-store",
              },
            );

          const body =
            await readJson(
              response,
            );

          if (
            !response.ok
          ) {
            throw new Error(
              getErrorMessage(
                body,
                "Unable to load browser status.",
              ),
            );
          }

          const session =
            body.session &&
            typeof body.session ===
              "object"
              ? (body.session as BrowserSession)
              : null;

          updateRuntime(
            accountId,
            {
              loading: false,
              running:
                body.running ===
                true,
              session,
              error: "",
            },
          );
        } catch (error) {
          updateRuntime(
            accountId,
            {
              loading: false,
              error:
                error instanceof
                Error
                  ? error.message
                  : "Unable to load browser status.",
            },
          );
        }
      },
      [
        updateRuntime,
      ],
    );

  const loadAccounts =
    useCallback(
      async () => {
        setLoading(true);
        setGlobalError("");

        try {
          const response =
            await fetch(
              `${API_URL}/browser-runtime/accounts`,
              {
                cache:
                  "no-store",
              },
            );

          const body =
            await readJson(
              response,
            );

          if (
            !response.ok
          ) {
            throw new Error(
              getErrorMessage(
                body,
                "Unable to load browser accounts.",
              ),
            );
          }

          const nextAccounts =
            (
              Array.isArray(
                body,
              )
                ? body
                : []
            ) as BrowserAccount[];

          setAccounts(
            nextAccounts,
          );

          setSelectedId(
            (current) => {
              const requested =
                requestedAccountId &&
                nextAccounts.some(
                  (account) =>
                    account.id ===
                    requestedAccountId,
                )
                  ? requestedAccountId
                  : null;

              const currentExists =
                current &&
                nextAccounts.some(
                  (account) =>
                    account.id ===
                    current,
                );

              return (
                requested ||
                (currentExists
                  ? current
                  : null) ||
                nextAccounts[0]
                  ?.id ||
                null
              );
            },
          );

          await Promise.all(
            nextAccounts.map(
              (account) =>
                loadRuntime(
                  account.id,
                ),
            ),
          );
        } catch (error) {
          setGlobalError(
            error instanceof
              Error
              ? error.message
              : "Unable to load browser accounts.",
          );
        } finally {
          setLoading(false);
        }
      },
      [
        loadRuntime,
        requestedAccountId,
      ],
    );

  useEffect(() => {
    void loadAccounts();
  }, [
    loadAccounts,
  ]);

  async function openBrowser(
    accountId: string,
  ) {
    setActionMessage("");
    updateRuntime(
      accountId,
      {
        loading: true,
        error: "",
      },
    );

    const response =
      await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/browser/open`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            headless: false,
            startUrl:
              "https://www.facebook.com/",
          }),
        },
      );

    const body =
      await readJson(
        response,
      );

    if (!response.ok) {
      updateRuntime(
        accountId,
        {
          loading: false,
          error:
            getErrorMessage(
              body,
              "Unable to open browser.",
            ),
        },
      );

      throw new Error(
        getErrorMessage(
          body,
          "Unable to open browser.",
        ),
      );
    }

    await Promise.all([
      loadRuntime(
        accountId,
      ),
      loadAccounts(),
    ]);

    setActionMessage(
      "Browser profile opened.",
    );

    window.open(
      NOVNC_URL,
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function verifyLogin(
    accountId: string,
  ) {
    setActionMessage("");

    updateRuntime(
      accountId,
      {
        loading: true,
        error: "",
      },
    );

    const response =
      await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/browser/inspect`,
        {
          method: "POST",
        },
      );

    const body =
      await readJson(
        response,
      );

    if (!response.ok) {
      updateRuntime(
        accountId,
        {
          loading: false,
          error:
            getErrorMessage(
              body,
              "Unable to verify login.",
            ),
        },
      );

      throw new Error(
        getErrorMessage(
          body,
          "Unable to verify login.",
        ),
      );
    }

    const result =
      body as InspectionResult;

    await Promise.all([
      loadAccounts(),
      loadRuntime(
        accountId,
      ),
    ]);

    const status =
      readableStatus(
        result.loginStatus,
      );

    setActionMessage(
      `Login verification: ${status}.`,
    );
  }

  async function closeBrowser(
    accountId: string,
  ) {
    setActionMessage("");

    updateRuntime(
      accountId,
      {
        loading: true,
        error: "",
      },
    );

    const response =
      await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/browser/close`,
        {
          method: "POST",
        },
      );

    const body =
      await readJson(
        response,
      );

    if (!response.ok) {
      updateRuntime(
        accountId,
        {
          loading: false,
          error:
            getErrorMessage(
              body,
              "Unable to close browser.",
            ),
        },
      );

      throw new Error(
        getErrorMessage(
          body,
          "Unable to close browser.",
        ),
      );
    }

    await Promise.all([
      loadRuntime(
        accountId,
      ),
      loadAccounts(),
    ]);

    setActionMessage(
      "Browser profile closed. Cookies remain stored in the profile.",
    );
  }

  function toggleBatch(
    accountId: string,
  ) {
    setSelectedForBatch(
      (current) => {
        const next =
          new Set(
            current,
          );

        if (
          next.has(
            accountId,
          )
        ) {
          next.delete(
            accountId,
          );
        } else {
          next.add(
            accountId,
          );
        }

        return next;
      },
    );
  }

  function toggleAllVisible() {
    const visibleIds =
      filteredAccounts.map(
        (account) =>
          account.id,
      );

    const allSelected =
      visibleIds.length >
        0 &&
      visibleIds.every(
        (id) =>
          selectedForBatch.has(
            id,
          ),
      );

    setSelectedForBatch(
      (current) => {
        const next =
          new Set(
            current,
          );

        for (
          const id
          of visibleIds
        ) {
          if (allSelected) {
            next.delete(id);
          } else {
            next.add(id);
          }
        }

        return next;
      },
    );
  }

  async function verifySelected() {
    const selected =
      accounts.filter(
        (account) =>
          selectedForBatch.has(
            account.id,
          ),
      );

    if (
      !selected.length
    ) {
      return;
    }

    setGlobalError("");
    setActionMessage(
      `Verifying ${selected.length} account(s)…`,
    );

    for (
      const account
      of selected
    ) {
      try {
        await verifyLogin(
          account.id,
        );
      } catch (error) {
        setGlobalError(
          error instanceof
            Error
            ? error.message
            : "Batch verification failed.",
        );
        break;
      }
    }

    setActionMessage(
      "Batch verification completed.",
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            Browser Runtime V2
          </p>

          <h1>
            Facebook Accounts
          </h1>

          <p className={styles.subtitle}>
            Independent profiles, cookies,
            proxies and login sessions.
          </p>
        </div>

        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() =>
            void loadAccounts()
          }
        >
          Refresh
        </button>
      </header>

      {globalError ? (
        <div className={styles.error}>
          {globalError}
        </div>
      ) : null}

      {actionMessage ? (
        <div className={styles.success}>
          {actionMessage}
        </div>
      ) : null}

      <section className={styles.toolbar}>
        <input
          className={styles.search}
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value,
            )
          }
          placeholder="Search account, profile, IP or status…"
        />

        <div className={styles.toolbarActions}>
          <span className={styles.selectionCount}>
            {
              selectedForBatch.size
            } selected
          </span>

          <button
            className={styles.primaryButton}
            type="button"
            disabled={
              selectedForBatch.size ===
              0
            }
            onClick={() =>
              void verifySelected()
            }
          >
            Verify Selected
          </button>
        </div>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkboxCell}>
                  <input
                    type="checkbox"
                    checked={
                      filteredAccounts.length >
                        0 &&
                      filteredAccounts.every(
                        (account) =>
                          selectedForBatch.has(
                            account.id,
                          ),
                      )
                    }
                    onChange={
                      toggleAllVisible
                    }
                  />
                </th>

                <th>Account</th>
                <th>Login</th>
                <th>Cookie</th>
                <th>Proxy</th>
                <th>Browser</th>
                <th>IP</th>
                <th>Last verified</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    className={styles.emptyCell}
                    colSpan={8}
                  >
                    Loading browser accounts…
                  </td>
                </tr>
              ) : null}

              {!loading &&
              !filteredAccounts.length ? (
                <tr>
                  <td
                    className={styles.emptyCell}
                    colSpan={8}
                  >
                    No independent browser accounts found.
                  </td>
                </tr>
              ) : null}

              {filteredAccounts.map(
                (account) => {
                  const runtime =
                    runtimes[
                      account.id
                    ] ||
                    EMPTY_RUNTIME;

                  const selected =
                    selectedId ===
                    account.id;

                  return (
                    <tr
                      className={
                        selected
                          ? styles.selectedRow
                          : undefined
                      }
                      key={account.id}
                      onClick={() =>
                        setSelectedId(
                          account.id,
                        )
                      }
                    >
                      <td
                        className={
                          styles.checkboxCell
                        }
                        onClick={(
                          event,
                        ) =>
                          event.stopPropagation()
                        }
                      >
                        <input
                          type="checkbox"
                          checked={selectedForBatch.has(
                            account.id,
                          )}
                          onChange={() =>
                            toggleBatch(
                              account.id,
                            )
                          }
                        />
                      </td>

                      <td>
                        <strong>
                          {
                            account.displayName
                          }
                        </strong>

                        <small>
                          {
                            account.browserProfileName
                          }
                        </small>
                      </td>

                      <td>
                        <span
                          className={[
                            styles.status,
                            loginStatusClass(
                              account.loginStatus,
                            ),
                          ].join(" ")}
                        >
                          {readableStatus(
                            account.loginStatus,
                          )}
                        </span>
                      </td>

                      <td>
                        <span
                          className={[
                            styles.status,
                            account.cookieStatus ===
                            "ACTIVE"
                              ? styles.good
                              : styles.neutral,
                          ].join(" ")}
                        >
                          {readableStatus(
                            account.cookieStatus,
                          )}
                        </span>
                      </td>

                      <td>
                        <strong>
                          {
                            account.proxyType
                          }
                        </strong>

                        <small>
                          {account.proxyCountry ||
                            "—"}
                        </small>
                      </td>

                      <td>
                        <span
                          className={[
                            styles.status,
                            runtime.running
                              ? styles.good
                              : styles.neutral,
                          ].join(" ")}
                        >
                          {runtime.loading
                            ? "CHECKING"
                            : runtime.running
                              ? "RUNNING"
                              : "STOPPED"}
                        </span>
                      </td>

                      <td>
                        {account.lastKnownIp ||
                          "—"}
                      </td>

                      <td>
                        {formatDate(
                          account.lastVerifiedAt,
                        )}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.detailsPanel}>
        {!selectedAccount ? (
          <div className={styles.emptyDetails}>
            Select an account to view details.
          </div>
        ) : (
          <>
            <div className={styles.detailsHeader}>
              <div>
                <p className={styles.eyebrow}>
                  Account Details
                </p>

                <h2>
                  {
                    selectedAccount.displayName
                  }
                </h2>

                <p>
                  {
                    selectedAccount.browserProfileKey
                  }
                </p>
              </div>

              <span
                className={[
                  styles.largeStatus,
                  loginStatusClass(
                    selectedAccount.loginStatus,
                  ),
                ].join(" ")}
              >
                {readableStatus(
                  selectedAccount.loginStatus,
                )}
              </span>
            </div>

            {selectedRuntime.error ? (
              <div className={styles.error}>
                {
                  selectedRuntime.error
                }
              </div>
            ) : null}

            <div className={styles.metrics}>
              <article>
                <span>
                  Browser
                </span>
                <strong>
                  {selectedRuntime.running
                    ? "RUNNING"
                    : "STOPPED"}
                </strong>
              </article>

              <article>
                <span>
                  Cookie
                </span>
                <strong>
                  {readableStatus(
                    selectedAccount.cookieStatus,
                  )}
                </strong>
              </article>

              <article>
                <span>
                  Proxy
                </span>
                <strong>
                  {
                    selectedAccount.proxyType
                  }
                </strong>
              </article>

              <article>
                <span>
                  Pages
                </span>
                <strong>
                  {
                    selectedAccount.channels
                      .length
                  }
                </strong>
              </article>
            </div>

            <dl className={styles.definitionList}>
              <div>
                <dt>
                  Profile name
                </dt>
                <dd>
                  {
                    selectedAccount.browserProfileName
                  }
                </dd>
              </div>

              <div>
                <dt>
                  Current URL
                </dt>
                <dd>
                  {selectedRuntime.session
                    ?.currentUrl ||
                    "—"}
                </dd>
              </div>

              <div>
                <dt>
                  Profile directory
                </dt>
                <dd>
                  {selectedRuntime.session
                    ?.profileDirectory ||
                    "Created when opened"}
                </dd>
              </div>

              <div>
                <dt>
                  Locale / Timezone
                </dt>
                <dd>
                  {
                    selectedAccount.locale
                  }{" "}
                  /{" "}
                  {
                    selectedAccount.timezone
                  }
                </dd>
              </div>

              <div>
                <dt>
                  Last login
                </dt>
                <dd>
                  {formatDate(
                    selectedAccount.lastLoginAt,
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  Last verified
                </dt>
                <dd>
                  {formatDate(
                    selectedAccount.lastVerifiedAt,
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  Last heartbeat
                </dt>
                <dd>
                  {formatDate(
                    selectedAccount.lastHeartbeatAt,
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  Last error
                </dt>
                <dd>
                  {selectedAccount.lastLoginError ||
                    "—"}
                </dd>
              </div>
            </dl>

            <div className={styles.actions}>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={
                  selectedRuntime.loading
                }
                onClick={() =>
                  void openBrowser(
                    selectedAccount.id,
                  ).catch(
                    (error) =>
                      setGlobalError(
                        error instanceof
                          Error
                          ? error.message
                          : "Unable to open browser.",
                      ),
                  )
                }
              >
                Open Browser
              </button>

              <button
                className={styles.secondaryButton}
                type="button"
                disabled={
                  selectedRuntime.loading
                }
                onClick={() =>
                  void verifyLogin(
                    selectedAccount.id,
                  ).catch(
                    (error) =>
                      setGlobalError(
                        error instanceof
                          Error
                          ? error.message
                          : "Unable to verify login.",
                      ),
                  )
                }
              >
                Verify Login
              </button>

              <button
                className={styles.dangerButton}
                type="button"
                disabled={
                  selectedRuntime.loading ||
                  !selectedRuntime.running
                }
                onClick={() =>
                  void closeBrowser(
                    selectedAccount.id,
                  ).catch(
                    (error) =>
                      setGlobalError(
                        error instanceof
                          Error
                          ? error.message
                          : "Unable to close browser.",
                      ),
                  )
                }
              >
                Close Browser
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
