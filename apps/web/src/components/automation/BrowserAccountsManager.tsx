"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_URL } from "@/lib/api";
import styles from "./BrowserAccountsManager.module.css";

type Platform =
  | "FACEBOOK"
  | "TELEGRAM"
  | string;

type Channel = {
  id: string;
  name: string;
  platform: Platform;
  status?: string | null;
  username?: string | null;
  externalId?: string | null;
  lastConnectedAt?: string | null;
  lastError?: string | null;
};

type ProxyType =
  | "DIRECT"
  | "HTTP"
  | "HTTPS"
  | "SOCKS5";

type RuntimeProfile = {
  id: string | null;
  channelId: string;
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
  lastKnownIp: string | null;
  lastConnectionStatus: string | null;
  lastConnectionError: string | null;
  lastConnectionTestAt: string | null;
};

type BrowserSession = {
  channelId: string;
  browserProfileKey: string;
  openedAt: string;
  locale: string;
  timezone: string;
  proxyType: ProxyType;
  headless: boolean;
  currentUrl: string | null;
};

type AccountDetails = {
  profile: RuntimeProfile | null;
  browserRunning: boolean;
  session: BrowserSession | null;
  loading: boolean;
  error: string;
};

type QueueStatus =
  | "QUEUED"
  | "OPENING"
  | "WAITING_FOR_LOGIN"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

type QueueItem = {
  channelId: string;
  channelName: string;
  status: QueueStatus;
  message?: string;
};

const EMPTY_DETAILS: AccountDetails = {
  profile: null,
  browserRunning: false,
  session: null,
  loading: false,
  error: "",
};

const NOVNC_URL =
  process.env.NEXT_PUBLIC_BROWSER_VIEW_URL ||
  "https://browser-worker-production-536a.up.railway.app/vnc.html";

async function readJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const raw = await response.text();

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<
      string,
      unknown
    >;
  } catch {
    return {
      message: raw,
    };
  }
}

function getErrorMessage(
  body: Record<string, unknown>,
  fallback: string,
) {
  if (
    typeof body.message === "string" &&
    body.message.trim()
  ) {
    return body.message;
  }

  return fallback;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
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

function statusLabel(
  details: AccountDetails | undefined,
) {
  if (!details) {
    return "Not checked";
  }

  if (details.loading) {
    return "Checking";
  }

  if (details.error) {
    return "Attention";
  }

  if (details.browserRunning) {
    return "Running";
  }

  if (details.profile) {
    return "Ready";
  }

  return "Not configured";
}

export function BrowserAccountsManager() {
  const [channels, setChannels] =
    useState<Channel[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [selectedId, setSelectedId] =
    useState<string | null>(null);

  const [detailsById, setDetailsById] =
    useState<Record<string, AccountDetails>>(
      {},
    );

  const [selectedForBatch, setSelectedForBatch] =
    useState<Set<string>>(
      new Set(),
    );

  const [queue, setQueue] =
    useState<QueueItem[]>([]);

  const [queueRunning, setQueueRunning] =
    useState(false);

  const [currentQueueIndex, setCurrentQueueIndex] =
    useState<number | null>(null);

  const selectedChannel =
    channels.find(
      (channel) =>
        channel.id === selectedId,
    ) || null;

  const selectedDetails =
    selectedId
      ? detailsById[selectedId] ||
        EMPTY_DETAILS
      : EMPTY_DETAILS;

  const filteredChannels =
    useMemo(() => {
      const query =
        search.trim().toLowerCase();

      return channels.filter(
        (channel) => {
          if (
            channel.platform !==
            "FACEBOOK"
          ) {
            return false;
          }

          if (!query) {
            return true;
          }

          return [
            channel.name,
            channel.username,
            channel.externalId,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(query),
            );
        },
      );
    }, [channels, search]);

  useEffect(() => {
    void loadChannels();
  }, []);

  useEffect(() => {
    if (selectedId) {
      void loadDetails(selectedId);
    }
  }, [selectedId]);

  async function loadChannels() {
    setLoading(true);
    setError("");

    try {
      const response =
        await fetch(
          `${API_URL}/automation/channels`,
          {
            cache: "no-store",
          },
        );

      const body =
        await readJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            body,
            "Unable to load channels.",
          ),
        );
      }

      const candidate =
        Array.isArray(body)
          ? body
          : Array.isArray(body.channels)
            ? body.channels
            : [];

      const nextChannels =
        candidate as Channel[];

      setChannels(nextChannels);

      const firstFacebook =
        nextChannels.find(
          (channel) =>
            channel.platform ===
            "FACEBOOK",
        );

      setSelectedId(
        (current) =>
          current ||
          firstFacebook?.id ||
          null,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load channels.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadDetails(
    channelId: string,
  ) {
    setDetailsById(
      (current) => ({
        ...current,
        [channelId]: {
          ...(current[channelId] ||
            EMPTY_DETAILS),
          loading: true,
          error: "",
        },
      }),
    );

    try {
      const [
        profileResponse,
        statusResponse,
      ] = await Promise.all([
        fetch(
          `${API_URL}/automation/channels/${channelId}/runtime-profile`,
          {
            cache: "no-store",
          },
        ),
        fetch(
          `${API_URL}/automation/channels/${channelId}/browser/status`,
          {
            cache: "no-store",
          },
        ),
      ]);

      const profileBody =
        await readJson(
          profileResponse,
        );

      const statusBody =
        await readJson(
          statusResponse,
        );

      if (!profileResponse.ok) {
        throw new Error(
          getErrorMessage(
            profileBody,
            "Unable to load runtime profile.",
          ),
        );
      }

      const profile =
        (
          profileBody.profile ||
          null
        ) as RuntimeProfile | null;

      const browserRunning =
        statusResponse.ok &&
        statusBody.running === true;

      const session =
        statusResponse.ok &&
        statusBody.session &&
        typeof statusBody.session ===
          "object"
          ? (
              statusBody.session as
                BrowserSession
            )
          : null;

      setDetailsById(
        (current) => ({
          ...current,
          [channelId]: {
            profile,
            browserRunning,
            session,
            loading: false,
            error: "",
          },
        }),
      );
    } catch (detailsError) {
      setDetailsById(
        (current) => ({
          ...current,
          [channelId]: {
            ...(current[channelId] ||
              EMPTY_DETAILS),
            loading: false,
            error:
              detailsError instanceof Error
                ? detailsError.message
                : "Unable to load account details.",
          },
        }),
      );
    }
  }

  async function openBrowser(
    channelId: string,
  ) {
    const response =
      await fetch(
        `${API_URL}/automation/channels/${channelId}/browser/open`,
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
      await readJson(response);

    if (!response.ok) {
      throw new Error(
        getErrorMessage(
          body,
          "Unable to open browser.",
        ),
      );
    }

    await loadDetails(channelId);

    window.open(
      NOVNC_URL,
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function closeBrowser(
    channelId: string,
  ) {
    const response =
      await fetch(
        `${API_URL}/automation/channels/${channelId}/browser/close`,
        {
          method: "POST",
        },
      );

    const body =
      await readJson(response);

    if (!response.ok) {
      throw new Error(
        getErrorMessage(
          body,
          "Unable to close browser.",
        ),
      );
    }

    await loadDetails(channelId);
  }

  async function verifyLogin(
    channelId: string,
  ) {
    const response =
      await fetch(
        `${API_URL}/automation/channels/${channelId}/browser/inspect`,
        {
          method: "POST",
        },
      );

    const body =
      await readJson(response);

    if (!response.ok) {
      throw new Error(
        getErrorMessage(
          body,
          "Unable to verify login.",
        ),
      );
    }

    const page =
      body.page &&
      typeof body.page === "object"
        ? (
            body.page as Record<
              string,
              unknown
            >
          )
        : {};

    const url =
      typeof page.url === "string"
        ? page.url
        : "";

    const loginRequired =
      url.includes("/login") ||
      url.includes("/checkpoint") ||
      url.includes(
        "/two_step_verification",
      );

    if (loginRequired) {
      throw new Error(
        "Facebook login is not complete.",
      );
    }

    await loadDetails(channelId);

    return true;
  }

  async function testProxy(
    channelId: string,
  ) {
    const response =
      await fetch(
        `${API_URL}/automation/channels/${channelId}/runtime-profile/test-proxy`,
        {
          method: "POST",
        },
      );

    const body =
      await readJson(response);

    if (
      !response.ok ||
      body.success !== true
    ) {
      throw new Error(
        getErrorMessage(
          body,
          "Proxy test failed.",
        ),
      );
    }

    await loadDetails(channelId);
  }

  function toggleBatch(
    channelId: string,
  ) {
    setSelectedForBatch(
      (current) => {
        const next =
          new Set(current);

        if (next.has(channelId)) {
          next.delete(channelId);
        } else {
          next.add(channelId);
        }

        return next;
      },
    );
  }

  async function startBatchLogin() {
    const selected =
      channels.filter(
        (channel) =>
          selectedForBatch.has(
            channel.id,
          ),
      );

    if (!selected.length) {
      setError(
        "Select at least one Facebook account.",
      );
      return;
    }

    const nextQueue =
      selected.map(
        (channel): QueueItem => ({
          channelId:
            channel.id,
          channelName:
            channel.name,
          status:
            "QUEUED",
        }),
      );

    setQueue(nextQueue);
    setQueueRunning(true);
    setCurrentQueueIndex(0);

    await openQueueItem(
      nextQueue,
      0,
    );
  }

  async function openQueueItem(
    sourceQueue: QueueItem[],
    index: number,
  ) {
    const item =
      sourceQueue[index];

    if (!item) {
      setQueueRunning(false);
      setCurrentQueueIndex(null);
      return;
    }

    setSelectedId(
      item.channelId,
    );

    setQueue(
      (current) =>
        current.map(
          (entry, entryIndex) =>
            entryIndex === index
              ? {
                  ...entry,
                  status:
                    "OPENING",
                  message:
                    "Opening browser…",
                }
              : entry,
        ),
    );

    try {
      await openBrowser(
        item.channelId,
      );

      setQueue(
        (current) =>
          current.map(
            (
              entry,
              entryIndex,
            ) =>
              entryIndex === index
                ? {
                    ...entry,
                    status:
                      "WAITING_FOR_LOGIN",
                    message:
                      "Complete login in noVNC, then verify.",
                  }
                : entry,
          ),
      );
    } catch (queueError) {
      setQueue(
        (current) =>
          current.map(
            (
              entry,
              entryIndex,
            ) =>
              entryIndex === index
                ? {
                    ...entry,
                    status:
                      "FAILED",
                    message:
                      queueError instanceof
                      Error
                        ? queueError.message
                        : "Unable to open browser.",
                  }
                : entry,
          ),
      );
    }
  }

  async function verifyAndContinue() {
    if (
      currentQueueIndex === null
    ) {
      return;
    }

    const item =
      queue[
        currentQueueIndex
      ];

    if (!item) {
      return;
    }

    setQueue(
      (current) =>
        current.map(
          (entry, index) =>
            index ===
            currentQueueIndex
              ? {
                  ...entry,
                  status:
                    "VERIFYING",
                  message:
                    "Checking Facebook login…",
                }
              : entry,
        ),
    );

    try {
      await verifyLogin(
        item.channelId,
      );

      await closeBrowser(
        item.channelId,
      );

      const nextIndex =
        currentQueueIndex + 1;

      const updatedQueue =
        queue.map(
          (entry, index) =>
            index ===
            currentQueueIndex
              ? {
                  ...entry,
                  status:
                    "COMPLETED" as const,
                  message:
                    "Login verified.",
                }
              : entry,
        );

      setQueue(updatedQueue);

      if (
        nextIndex >=
        updatedQueue.length
      ) {
        setQueueRunning(false);
        setCurrentQueueIndex(null);
        return;
      }

      setCurrentQueueIndex(
        nextIndex,
      );

      await openQueueItem(
        updatedQueue,
        nextIndex,
      );
    } catch (verifyError) {
      setQueue(
        (current) =>
          current.map(
            (entry, index) =>
              index ===
              currentQueueIndex
                ? {
                    ...entry,
                    status:
                      "WAITING_FOR_LOGIN",
                    message:
                      verifyError instanceof
                      Error
                        ? verifyError.message
                        : "Login verification failed.",
                  }
                : entry,
          ),
      );
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            Browser Runtime
          </p>

          <h1>
            Facebook Accounts
          </h1>

          <p className={styles.subtitle}>
            Manage browser profiles,
            proxies, login sessions and
            batch onboarding.
          </p>
        </div>

        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() =>
            void loadChannels()
          }
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className={styles.error}>
          {error}
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value,
            )
          }
          placeholder="Search Facebook accounts…"
        />

        <button
          className={styles.primaryButton}
          type="button"
          disabled={
            queueRunning ||
            selectedForBatch.size ===
              0
          }
          onClick={() =>
            void startBatchLogin()
          }
        >
          Batch Login (
          {selectedForBatch.size})
        </button>
      </div>

      <div className={styles.layout}>
        <section className={styles.listPanel}>
          <div className={styles.panelTitle}>
            <span>
              Accounts
            </span>

            <span>
              {
                filteredChannels.length
              }
            </span>
          </div>

          {loading ? (
            <div className={styles.empty}>
              Loading accounts…
            </div>
          ) : null}

          {!loading &&
          !filteredChannels.length ? (
            <div className={styles.empty}>
              No Facebook channels found.
            </div>
          ) : null}

          <div className={styles.accountList}>
            {filteredChannels.map(
              (channel) => {
                const details =
                  detailsById[
                    channel.id
                  ];

                const selected =
                  selectedId ===
                  channel.id;

                return (
                  <div
                    className={[
                      styles.accountRow,
                      selected
                        ? styles.accountRowSelected
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={channel.id}
                  >
                    <label
                      className={
                        styles.checkboxWrap
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selectedForBatch.has(
                          channel.id,
                        )}
                        onChange={() =>
                          toggleBatch(
                            channel.id,
                          )
                        }
                      />
                    </label>

                    <button
                      className={
                        styles.accountButton
                      }
                      type="button"
                      onClick={() =>
                        setSelectedId(
                          channel.id,
                        )
                      }
                    >
                      <span
                        className={
                          styles.avatar
                        }
                      >
                        {channel.name
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>

                      <span
                        className={
                          styles.accountMain
                        }
                      >
                        <strong>
                          {channel.name}
                        </strong>

                        <small>
                          {channel.username ||
                            channel.externalId ||
                            "Facebook"}
                        </small>
                      </span>

                      <span
                        className={[
                          styles.statusPill,
                          details
                            ?.browserRunning
                            ? styles.good
                            : details?.error
                              ? styles.bad
                              : styles.neutral,
                        ].join(" ")}
                      >
                        {statusLabel(
                          details,
                        )}
                      </span>
                    </button>
                  </div>
                );
              },
            )}
          </div>
        </section>

        <section className={styles.detailsPanel}>
          {!selectedChannel ? (
            <div className={styles.empty}>
              Select an account to view
              details.
            </div>
          ) : (
            <>
              <div className={styles.detailsHeader}>
                <div>
                  <p
                    className={
                      styles.eyebrow
                    }
                  >
                    Account Details
                  </p>

                  <h2>
                    {
                      selectedChannel.name
                    }
                  </h2>

                  <p>
                    {selectedChannel.username ||
                      selectedChannel.externalId ||
                      selectedChannel.id}
                  </p>
                </div>

                <span
                  className={[
                    styles.largeStatus,
                    selectedDetails
                      .browserRunning
                      ? styles.good
                      : styles.neutral,
                  ].join(" ")}
                >
                  {selectedDetails
                    .browserRunning
                    ? "Browser Running"
                    : "Browser Stopped"}
                </span>
              </div>

              {selectedDetails.error ? (
                <div
                  className={
                    styles.error
                  }
                >
                  {
                    selectedDetails.error
                  }
                </div>
              ) : null}

              <div className={styles.metrics}>
                <article>
                  <span>
                    API Connection
                  </span>
                  <strong>
                    {selectedChannel.status ||
                      "UNKNOWN"}
                  </strong>
                </article>

                <article>
                  <span>
                    Browser
                  </span>
                  <strong>
                    {selectedDetails
                      .browserRunning
                      ? "RUNNING"
                      : "STOPPED"}
                  </strong>
                </article>

                <article>
                  <span>
                    Proxy
                  </span>
                  <strong>
                    {selectedDetails
                      .profile
                      ?.proxyType ||
                      "NOT SET"}
                  </strong>
                </article>

                <article>
                  <span>
                    Country
                  </span>
                  <strong>
                    {selectedDetails
                      .profile
                      ?.proxyCountry ||
                      "—"}
                  </strong>
                </article>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Browser Runtime
                </div>

                <dl className={styles.definitionList}>
                  <div>
                    <dt>
                      Profile
                    </dt>
                    <dd>
                      {selectedDetails
                        .profile
                        ?.browserProfileName ||
                        "Not configured"}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Profile key
                    </dt>
                    <dd>
                      {selectedDetails
                        .profile
                        ?.browserProfileKey ||
                        "—"}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Current URL
                    </dt>
                    <dd>
                      {selectedDetails
                        .session
                        ?.currentUrl ||
                        "—"}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Opened
                    </dt>
                    <dd>
                      {formatDate(
                        selectedDetails
                          .session
                          ?.openedAt,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Proxy
                </div>

                <dl className={styles.definitionList}>
                  <div>
                    <dt>
                      Type
                    </dt>
                    <dd>
                      {selectedDetails
                        .profile
                        ?.proxyType ||
                        "DIRECT"}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Endpoint
                    </dt>
                    <dd>
                      {selectedDetails
                        .profile
                        ?.proxyHost
                        ? `${selectedDetails.profile.proxyHost}:${selectedDetails.profile.proxyPort || ""}`
                        : "Direct connection"}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Last IP
                    </dt>
                    <dd>
                      {selectedDetails
                        .profile
                        ?.lastKnownIp ||
                        "—"}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Last tested
                    </dt>
                    <dd>
                      {formatDate(
                        selectedDetails
                          .profile
                          ?.lastConnectionTestAt,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className={styles.actions}>
                <button
                  className={
                    styles.primaryButton
                  }
                  type="button"
                  onClick={() =>
                    void openBrowser(
                      selectedChannel.id,
                    ).catch(
                      (actionError) =>
                        setError(
                          actionError instanceof
                          Error
                            ? actionError.message
                            : "Unable to open browser.",
                        ),
                    )
                  }
                >
                  Open Browser
                </button>

                <button
                  className={
                    styles.secondaryButton
                  }
                  type="button"
                  onClick={() =>
                    void verifyLogin(
                      selectedChannel.id,
                    )
                      .then(() =>
                        setError(""),
                      )
                      .catch(
                        (actionError) =>
                          setError(
                            actionError instanceof
                            Error
                              ? actionError.message
                              : "Login verification failed.",
                          ),
                      )
                  }
                >
                  Verify Login
                </button>

                <button
                  className={
                    styles.secondaryButton
                  }
                  type="button"
                  onClick={() =>
                    void testProxy(
                      selectedChannel.id,
                    ).catch(
                      (actionError) =>
                        setError(
                          actionError instanceof
                          Error
                            ? actionError.message
                            : "Proxy test failed.",
                        ),
                    )
                  }
                >
                  Test Proxy
                </button>

                <button
                  className={
                    styles.dangerButton
                  }
                  type="button"
                  onClick={() =>
                    void closeBrowser(
                      selectedChannel.id,
                    ).catch(
                      (actionError) =>
                        setError(
                          actionError instanceof
                          Error
                            ? actionError.message
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

      {queue.length ? (
        <section className={styles.queuePanel}>
          <div className={styles.queueHeader}>
            <div>
              <p className={styles.eyebrow}>
                Batch Login Queue
              </p>

              <h2>
                Login Progress
              </h2>
            </div>

            {queueRunning ? (
              <button
                className={
                  styles.primaryButton
                }
                type="button"
                onClick={() =>
                  void verifyAndContinue()
                }
              >
                Verify & Continue
              </button>
            ) : null}
          </div>

          <div className={styles.queueList}>
            {queue.map(
              (item, index) => (
                <div
                  className={
                    styles.queueItem
                  }
                  key={
                    item.channelId
                  }
                >
                  <span
                    className={
                      styles.queueNumber
                    }
                  >
                    {index + 1}
                  </span>

                  <div>
                    <strong>
                      {item.channelName}
                    </strong>

                    <p>
                      {item.message ||
                        item.status}
                    </p>
                  </div>

                  <span
                    className={
                      styles.queueStatus
                    }
                  >
                    {item.status}
                  </span>
                </div>
              ),
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
