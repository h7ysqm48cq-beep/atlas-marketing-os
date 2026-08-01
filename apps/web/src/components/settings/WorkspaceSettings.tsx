"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./WorkspaceSettings.module.css";

import { API_URL } from "@/lib/api";
type AutomationSettings = {
  id: string;
  workspaceId: string;
  timezone: string;
  approvalRequired: boolean;
  autoPublishEnabled: boolean;
  retryLimit: number;
  retryDelayMinutes: number;
  defaultFacebookTime: string;
  defaultTelegramTime: string;
};

type Channel = {
  id: string;
  brandId?: string;
  platform: "FACEBOOK" | "TELEGRAM";
  name: string;
  externalId?: string | null;
  username: string | null;
  status:
    | "DISCONNECTED"
    | "CONNECTED"
    | "EXPIRED"
    | "ERROR";
  hasAccessToken?: boolean;
  tokenExpiresAt?: string | null;
  lastConnectedAt?: string | null;
  lastError?: string | null;
  brand?: {
    id: string;
    name: string;
  };
};

type Brand = {
  id: string;
  name: string;
  primaryLanguage: string;
  country: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
};

type LocalPreferences = {
  currency: string;
  defaultModel: string;
  defaultLanguage: string;
};

const DEFAULT_LOCAL_PREFERENCES: LocalPreferences = {
  currency: "MYR",
  defaultModel: "gpt-5.6-luna",
  defaultLanguage: "Chinese and English",
};

export function WorkspaceSettings() {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);

  const [channels, setChannels] = useState<Channel[]>([]);

  const [brands, setBrands] = useState<Brand[]>([]);

  const [localPreferences, setLocalPreferences] = useState<LocalPreferences>(
    DEFAULT_LOCAL_PREFERENCES,
  );

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [
    connectingFacebook,
    setConnectingFacebook,
  ] = useState(false);

  const [
    activeChannelAction,
    setActiveChannelAction,
  ] = useState<string | null>(null);

  const [
    channelDiagnostics,
    setChannelDiagnostics,
  ] = useState<
    Record<
      string,
      {
        followers: number | null;
        category: string | null;
        link: string | null;
      }
    >
  >({});

  const [message, setMessage] = useState("");

  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [settingsResponse, channelsResponse, brandsResponse] =
        await Promise.all([
          fetch(`${API_URL}/automation/settings`, { cache: "no-store" }),
          fetch(`${API_URL}/automation/channels`, { cache: "no-store" }),
          fetch(`${API_URL}/brands`, { cache: "no-store" }),
        ]);

      if (!settingsResponse.ok || !channelsResponse.ok || !brandsResponse.ok) {
        throw new Error("Unable to load workspace settings.");
      }

      const [settingsData, channelsData, brandsData] = await Promise.all([
        settingsResponse.json() as Promise<AutomationSettings>,
        channelsResponse.json() as Promise<Channel[]>,
        brandsResponse.json() as Promise<Brand[]>,
      ]);

      setSettings(settingsData);
      setChannels(channelsData);
      setBrands(brandsData);

      const stored = window.localStorage.getItem("atlas.settings.preferences");

      if (stored) {
        try {
          setLocalPreferences({
            ...DEFAULT_LOCAL_PREFERENCES,
            ...JSON.parse(stored),
          });
        } catch {
          setLocalPreferences(DEFAULT_LOCAL_PREFERENCES);
        }
      } else if (brandsData[0]) {
        setLocalPreferences((current) => ({
          ...current,
          defaultLanguage: brandsData[0].primaryLanguage,
        }));
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workspace settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search,
      );

    const facebookStatus =
      params.get("facebook");

    if (facebookStatus === "connected") {
      const imported =
        params.get("imported") || "0";

      setMessage(
        `Facebook connected successfully. ${imported} Page(s) imported.`,
      );

      void load();

      const cleanUrl =
        new URL(
          window.location.href,
        );

      cleanUrl.searchParams.delete(
        "facebook",
      );
      cleanUrl.searchParams.delete(
        "imported",
      );
      cleanUrl.searchParams.delete(
        "brandId",
      );

      window.history.replaceState(
        {},
        "",
        cleanUrl.toString(),
      );
    }

    if (facebookStatus === "error") {
      setError(
        params.get("message") ||
          "Unable to connect Facebook.",
      );
    }
  }, [load]);

  const workspace = brands[0]?.workspace;
  const activeBrand = brands[0];

  const connectedChannels = useMemo(
    () => channels.filter((channel) => channel.status === "CONNECTED").length,
    [channels],
  );

  async function connectFacebook() {
    const brandId =
      activeBrand?.id;

    if (!brandId) {
      setError(
        "Create or select a brand before connecting Facebook.",
      );
      return;
    }

    setConnectingFacebook(true);
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          `${API_URL}/automation/facebook/connect?brandId=${encodeURIComponent(
            brandId,
          )}`,
          {
            cache: "no-store",
          },
        );

      const body =
        (await response.json()) as {
          authorizationUrl?: string;
          message?: string;
        };

      if (
        !response.ok ||
        !body.authorizationUrl
      ) {
        throw new Error(
          body.message ||
            "Unable to start Facebook connection.",
        );
      }

      window.location.assign(
        body.authorizationUrl,
      );
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Unable to connect Facebook.",
      );

      setConnectingFacebook(false);
    }
  }


  async function testChannel(
    channel: Channel,
  ) {
    setActiveChannelAction(
      `${channel.id}:test`,
    );
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${channel.id}/test`,
        {
          method: "POST",
        },
      );

      const body = (await response.json()) as {
        message?: string;
        channel?: Channel;
        connection?: {
          page?: {
            followers?: number | null;
            category?: string | null;
            link?: string | null;
          };
        };
      };

      if (!response.ok || !body.channel) {
        throw new Error(
          body.message ||
            "Unable to test this channel.",
        );
      }

      setChannels((current) =>
        current.map((item) =>
          item.id === channel.id
            ? {
                ...item,
                ...body.channel,
              }
            : item,
        ),
      );

      setChannelDiagnostics(
        (current) => ({
          ...current,
          [channel.id]: {
            followers:
              body.connection?.page
                ?.followers ?? null,
            category:
              body.connection?.page
                ?.category ?? null,
            link:
              body.connection?.page
                ?.link ?? null,
          },
        }),
      );

      setMessage(
        `${body.channel.name} connection is healthy.`,
      );
    } catch (channelError) {
      setError(
        channelError instanceof Error
          ? channelError.message
          : "Unable to test this channel.",
      );

      await load();
    } finally {
      setActiveChannelAction(null);
    }
  }

  async function reconnectChannel(
    channel: Channel,
  ) {
    const brandId =
      channel.brandId ||
      channel.brand?.id ||
      activeBrand?.id;

    if (!brandId) {
      setError(
        "This channel does not have a valid brand.",
      );
      return;
    }

    setActiveChannelAction(
      `${channel.id}:reconnect`,
    );
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/automation/facebook/connect?brandId=${encodeURIComponent(
          brandId,
        )}`,
        {
          cache: "no-store",
        },
      );

      const body = (await response.json()) as {
        authorizationUrl?: string;
        message?: string;
      };

      if (
        !response.ok ||
        !body.authorizationUrl
      ) {
        throw new Error(
          body.message ||
            "Unable to reconnect Facebook.",
        );
      }

      window.location.assign(
        body.authorizationUrl,
      );
    } catch (channelError) {
      setError(
        channelError instanceof Error
          ? channelError.message
          : "Unable to reconnect Facebook.",
      );
      setActiveChannelAction(null);
    }
  }

  async function disconnectChannel(
    channel: Channel,
  ) {
    const confirmed = window.confirm(
      `Disconnect ${channel.name}? Scheduled posts will remain, but publishing will stop until the Page is reconnected.`,
    );

    if (!confirmed) {
      return;
    }

    setActiveChannelAction(
      `${channel.id}:disconnect`,
    );
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${channel.id}/disconnect`,
        {
          method: "POST",
        },
      );

      const body = (await response.json()) as
        | Channel
        | { message?: string };

      if (!response.ok) {
        throw new Error(
          "message" in body && body.message
            ? body.message
            : "Unable to disconnect channel.",
        );
      }

      setChannels((current) =>
        current.map((item) =>
          item.id === channel.id
            ? {
                ...item,
                ...(body as Channel),
              }
            : item,
        ),
      );

      setMessage(
        `${channel.name} disconnected.`,
      );
    } catch (channelError) {
      setError(
        channelError instanceof Error
          ? channelError.message
          : "Unable to disconnect channel.",
      );
    } finally {
      setActiveChannelAction(null);
    }
  }

  async function deleteChannel(
    channel: Channel,
  ) {
    const confirmed = window.confirm(
      `Permanently delete ${channel.name}? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setActiveChannelAction(
      `${channel.id}:delete`,
    );
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${channel.id}`,
        {
          method: "DELETE",
        },
      );

      const body = (await response.json()) as {
        deleted?: boolean;
        message?: string;
      };

      if (!response.ok || !body.deleted) {
        throw new Error(
          body.message ||
            "Unable to delete channel.",
        );
      }

      setChannels((current) =>
        current.filter(
          (item) =>
            item.id !== channel.id,
        ),
      );

      setMessage(
        `${channel.name} deleted.`,
      );
    } catch (channelError) {
      setError(
        channelError instanceof Error
          ? channelError.message
          : "Unable to delete channel.",
      );
    } finally {
      setActiveChannelAction(null);
    }
  }


  async function saveSettings() {
    if (!settings) {
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`${API_URL}/automation/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timezone: settings.timezone,
          approvalRequired: settings.approvalRequired,
          autoPublishEnabled: settings.autoPublishEnabled,
          retryLimit: Number(settings.retryLimit),
          retryDelayMinutes: Number(settings.retryDelayMinutes),
          defaultFacebookTime: settings.defaultFacebookTime,
          defaultTelegramTime: settings.defaultTelegramTime,
        }),
      });

      if (!response.ok) {
        const body = await response.json();

        throw new Error(body.message || "Unable to save settings.");
      }

      const updated = (await response.json()) as AutomationSettings;

      setSettings(updated);

      window.localStorage.setItem(
        "atlas.settings.preferences",
        JSON.stringify(localPreferences),
      );

      setMessage("Settings saved successfully.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) {
    return <section className={styles.state}>Loading settings...</section>;
  }

  if (!settings) {
    return (
      <section className={styles.state}>
        <p>{error || "Settings unavailable."}</p>

        <button onClick={() => void load()}>Try again</button>
      </section>
    );
  }

  return (
    <div className={styles.settingsPage}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Workspace Administration</p>

          <h1>Settings</h1>

          <p>
            Manage workspace preferences, publishing defaults and AI behaviour.
          </p>
        </div>

        <button
          className={styles.primaryButton}
          onClick={() => void saveSettings()}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </section>

      {message ? <div className={styles.success}>{message}</div> : null}

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.summaryGrid}>
        <article>
          <span>Workspace</span>
          <strong>{workspace?.name || "Atlas"}</strong>
          <small>{workspace?.slug || "workspace"}</small>
        </article>

        <article>
          <span>Active brand</span>
          <strong>{activeBrand?.name || "No brand"}</strong>
          <small>{activeBrand?.country || "Malaysia"}</small>
        </article>

        <article>
          <span>Channels</span>
          <strong>
            {connectedChannels}/{channels.length}
          </strong>
          <small>Connected platforms</small>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>Workspace</p>
              <h2>General preferences</h2>
            </div>
          </header>

          <div className={styles.formGrid}>
            <label>
              <span>Workspace name</span>
              <input value={workspace?.name || ""} disabled />
            </label>

            <label>
              <span>Default brand</span>
              <input value={activeBrand?.name || ""} disabled />
            </label>

            <label>
              <span>Timezone</span>
              <select
                value={settings.timezone}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          timezone: event.target.value,
                        }
                      : current,
                  )
                }
              >
                <option value="Asia/Kuala_Lumpur">Asia/Kuala_Lumpur</option>
                <option value="Asia/Singapore">Asia/Singapore</option>
                <option value="UTC">UTC</option>
              </select>
            </label>

            <label>
              <span>Currency</span>
              <select
                value={localPreferences.currency}
                onChange={(event) =>
                  setLocalPreferences((current) => ({
                    ...current,
                    currency: event.target.value,
                  }))
                }
              >
                <option value="MYR">MYR</option>
                <option value="USD">USD</option>
                <option value="SGD">SGD</option>
              </select>
            </label>

            <label>
              <span>Default language</span>
              <select
                value={localPreferences.defaultLanguage}
                onChange={(event) =>
                  setLocalPreferences((current) => ({
                    ...current,
                    defaultLanguage: event.target.value,
                  }))
                }
              >
                <option value="Chinese and English">Chinese and English</option>
                <option value="Chinese">Chinese</option>
                <option value="English">English</option>
              </select>
            </label>

            <label>
              <span>Default AI model</span>
              <select
                value={localPreferences.defaultModel}
                onChange={(event) =>
                  setLocalPreferences((current) => ({
                    ...current,
                    defaultModel: event.target.value,
                  }))
                }
              >
                <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
              </select>
            </label>
          </div>
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>Publishing</p>
              <h2>Automation defaults</h2>
            </div>
          </header>

          <div className={styles.toggleList}>
            <label>
              <div>
                <strong>Approval required</strong>
                <span>Require approval before scheduling content.</span>
              </div>

              <input
                type="checkbox"
                checked={settings.approvalRequired}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          approvalRequired: event.target.checked,
                        }
                      : current,
                  )
                }
              />
            </label>

            <label>
              <div>
                <strong>Auto publish</strong>
                <span>Automatically send queued posts when due.</span>
              </div>

              <input
                type="checkbox"
                checked={settings.autoPublishEnabled}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          autoPublishEnabled: event.target.checked,
                        }
                      : current,
                  )
                }
              />
            </label>
          </div>

          <div className={styles.formGrid}>
            <label>
              <span>Default Facebook time</span>
              <input
                type="time"
                value={settings.defaultFacebookTime}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          defaultFacebookTime: event.target.value,
                        }
                      : current,
                  )
                }
              />
            </label>

            <label>
              <span>Default Telegram time</span>
              <input
                type="time"
                value={settings.defaultTelegramTime}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          defaultTelegramTime: event.target.value,
                        }
                      : current,
                  )
                }
              />
            </label>

            <label>
              <span>Retry attempts</span>
              <input
                type="number"
                min="0"
                max="10"
                value={settings.retryLimit}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          retryLimit: Number(event.target.value),
                        }
                      : current,
                  )
                }
              />
            </label>

            <label>
              <span>Retry delay (minutes)</span>
              <input
                type="number"
                min="1"
                max="1440"
                value={settings.retryDelayMinutes}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          retryDelayMinutes: Number(event.target.value),
                        }
                      : current,
                  )
                }
              />
            </label>
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <header>
          <div>
            <p className={styles.eyebrow}>Connections</p>
            <h2>Social channels</h2>
          </div>

          <div className={styles.connectionActions}>
            <button
              type="button"
              onClick={() =>
                void connectFacebook()
              }
              disabled={connectingFacebook}
            >
              {connectingFacebook
                ? "Connecting..."
                : "+ Connect Facebook"}
            </button>

            <a href="/automation">
              Open automation
            </a>
          </div>
        </header>

        <div className={styles.channelGrid}>
          {channels.map((channel) => {
            const diagnostics =
              channelDiagnostics[channel.id];

            const channelBusy =
              activeChannelAction?.startsWith(
                `${channel.id}:`,
              ) ?? false;

            return (
              <article
                key={channel.id}
                className={styles.channelCard}
              >
                <div className={styles.channelTop}>
                  <div
                    className={`${styles.channelIcon} ${
                      channel.platform === "FACEBOOK"
                        ? styles.facebook
                        : styles.telegram
                    }`}
                  >
                    {channel.platform === "FACEBOOK"
                      ? "f"
                      : "✈"}
                  </div>

                  <div className={styles.channelIdentity}>
                    <strong>{channel.name}</strong>

                    <span>
                      {channel.username
                        ? `@${channel.username}`
                        : channel.externalId
                          ? `Page ID: ${channel.externalId}`
                          : "No Page ID"}
                    </span>

                    <small>
                      {channel.hasAccessToken
                        ? "Token configured"
                        : "Token not configured"}
                      {channel.brand?.name
                        ? ` · ${channel.brand.name}`
                        : ""}
                    </small>
                  </div>

                  <b
                    className={
                      channel.status === "CONNECTED"
                        ? styles.connected
                        : styles.disconnected
                    }
                  >
                    {channel.status}
                  </b>
                </div>

                <div className={styles.channelMeta}>
                  <div>
                    <span>Last connected</span>
                    <strong>
                      {channel.lastConnectedAt
                        ? new Date(
                            channel.lastConnectedAt,
                          ).toLocaleString()
                        : "Never"}
                    </strong>
                  </div>

                  <div>
                    <span>Token expiry</span>
                    <strong>
                      {channel.tokenExpiresAt
                        ? new Date(
                            channel.tokenExpiresAt,
                          ).toLocaleString()
                        : "Not provided"}
                    </strong>
                  </div>

                  {diagnostics ? (
                    <>
                      <div>
                        <span>Followers</span>
                        <strong>
                          {diagnostics.followers ??
                            "Unavailable"}
                        </strong>
                      </div>

                      <div>
                        <span>Category</span>
                        <strong>
                          {diagnostics.category ??
                            "Unavailable"}
                        </strong>
                      </div>
                    </>
                  ) : null}
                </div>

                {channel.lastError ? (
                  <p className={styles.channelError}>
                    {channel.lastError}
                  </p>
                ) : null}

                <div className={styles.channelActions}>
                  {channel.platform === "FACEBOOK" ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void testChannel(channel)
                        }
                        disabled={channelBusy}
                      >
                        {activeChannelAction ===
                        `${channel.id}:test`
                          ? "Testing..."
                          : "Test"}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void reconnectChannel(
                            channel,
                          )
                        }
                        disabled={channelBusy}
                      >
                        Reconnect
                      </button>

                      {channel.status !==
                      "DISCONNECTED" ? (
                        <button
                          type="button"
                          onClick={() =>
                            void disconnectChannel(
                              channel,
                            )
                          }
                          disabled={channelBusy}
                        >
                          Disconnect
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() =>
                      void deleteChannel(channel)
                    }
                    disabled={channelBusy}
                  >
                    {activeChannelAction ===
                    `${channel.id}:delete`
                      ? "Deleting..."
                      : "Delete"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
