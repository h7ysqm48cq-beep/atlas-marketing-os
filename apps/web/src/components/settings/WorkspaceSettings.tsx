"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./WorkspaceSettings.module.css";
import { RuntimeProfileEditor } from "./RuntimeProfileEditor";

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

type BrowserPublishingAccount = {
  id: string;
  displayName: string;
  browserProfileKey: string;
  browserProfileName: string;
  loginStatus: string;
  cookieStatus: string;
  proxyType: string;
  proxyCountry: string | null;
  lastKnownIp: string | null;
  lastLoginAt: string | null;
  lastVerifiedAt: string | null;
  lastHeartbeatAt: string | null;
  lastLoginError: string | null;
  isPrimary: boolean;
  health: {
    score: number;
    status: "HEALTHY" | "WARNING" | "CRITICAL" | string;
  };
};

type BrowserAccountOption = {
  id: string;
  displayName: string;
  platform: string;
  brandId: string | null;
  loginStatus: string;
  cookieStatus: string;
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
  publishingPreference?:
    | "AUTOMATIC"
    | "NATIVE_API"
    | "BROWSER_RUNTIME";
  tokenExpiresAt?: string | null;
  lastConnectedAt?: string | null;
  lastError?: string | null;

  publishingMode?:
    | "BROWSER_RUNTIME"
    | "NATIVE_API"
    | "UNCONFIGURED"
    | string;

  managedBy?: {
    id: string;
    displayName: string;
    browserProfileName: string;
  } | null;

  browserAccounts?: BrowserPublishingAccount[];
  primaryBrowserAccount?: BrowserPublishingAccount | null;

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

  const [browserAccounts, setBrowserAccounts] = useState<
    BrowserAccountOption[]
  >([]);

  const [browserAccountSelections, setBrowserAccountSelections] = useState<
    Record<string, string>
  >({});

  const [localPreferences, setLocalPreferences] = useState<LocalPreferences>(
    DEFAULT_LOCAL_PREFERENCES,
  );

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [
    connectingFacebook,
    setConnectingFacebook,
  ] = useState(false);

  const [showTelegramForm, setShowTelegramForm] = useState(false);
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  const [verifiedTelegramBot, setVerifiedTelegramBot] = useState<{
    name: string;
    username: string | null;
  } | null>(null);
  const [telegramForm, setTelegramForm] = useState({
    brandId: "",
    name: "",
    chatId: "",
    botToken: "",
  });

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
      const [
        settingsResponse,
        channelsResponse,
        brandsResponse,
        accountsResponse,
      ] = await Promise.all([
          fetch(`${API_URL}/automation/settings`, { cache: "no-store" }),
          fetch(`${API_URL}/automation/channels`, { cache: "no-store" }),
          fetch(`${API_URL}/brands`, { cache: "no-store" }),
          fetch(`${API_URL}/browser-runtime/accounts`, { cache: "no-store" }),
        ]);

      if (
        !settingsResponse.ok ||
        !channelsResponse.ok ||
        !brandsResponse.ok
      ) {
        throw new Error("Unable to load workspace settings.");
      }

      const [settingsData, channelsData, brandsData, accountsData] =
        await Promise.all([
          settingsResponse.json() as Promise<AutomationSettings>,
          channelsResponse.json() as Promise<Channel[]>,
          brandsResponse.json() as Promise<Brand[]>,
          accountsResponse.ok
            ? (accountsResponse.json() as Promise<BrowserAccountOption[]>)
            : Promise.resolve([]),
        ]);

      setSettings(settingsData);
      setChannels(channelsData);
      setBrands(brandsData);
      setBrowserAccounts(Array.isArray(accountsData) ? accountsData : []);

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

  async function responseBody(response: Response) {
    const text = await response.text();

    if (!text.trim()) return {} as Record<string, unknown>;

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { message: text } as Record<string, unknown>;
    }
  }

  async function openBrowserAccount(channel: Channel, accountId: string) {
    setActiveChannelAction(`${channel.id}:open-browser`);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/browser/open`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            headless: false,
            startUrl: "https://www.facebook.com/",
          }),
        },
      );
      const body = await responseBody(response);

      if (!response.ok) {
        throw new Error(
          typeof body.message === "string"
            ? body.message
            : "Unable to open Browser Account.",
        );
      }

      setMessage(
        body.alreadyRunning
          ? `${channel.name} Browser Account is already open.`
          : `${channel.name} Browser Account opened.`,
      );
      await load();
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Unable to open Browser Account.",
      );
    } finally {
      setActiveChannelAction(null);
    }
  }

  async function linkBrowserAccount(channel: Channel) {
    const accountId = browserAccountSelections[channel.id];

    if (!accountId) {
      setError("Select a Browser Account first.");
      return;
    }

    setActiveChannelAction(`${channel.id}:link-browser`);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/channels/${channel.id}/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPrimary: true }),
        },
      );
      const body = await responseBody(response);

      if (!response.ok) {
        throw new Error(
          typeof body.message === "string"
            ? body.message
            : "Unable to link Browser Account.",
        );
      }

      setMessage(`${channel.name} linked to the selected Browser Account.`);
      await load();
    } catch (linkError) {
      setError(
        linkError instanceof Error
          ? linkError.message
          : "Unable to link Browser Account.",
      );
    } finally {
      setActiveChannelAction(null);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetch persisted workspace settings when the panel mounts.
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

      // eslint-disable-next-line react-hooks/set-state-in-effect -- Surface the OAuth redirect result encoded in the browser URL.
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

  async function connectTelegram() {
    const brandId = telegramForm.brandId || activeBrand?.id || "";

    if (!brandId || !telegramForm.chatId.trim() || !telegramForm.botToken.trim()) {
      setError("Brand, Telegram Chat ID and Bot Token are required.");
      return;
    }

    setConnectingTelegram(true);
    setMessage("");
    setError("");

    try {
      const createResponse = await fetch(`${API_URL}/automation/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          platform: "TELEGRAM",
          name: telegramForm.name.trim() || "Telegram Channel",
          externalId: telegramForm.chatId.trim(),
          accessToken: telegramForm.botToken.trim(),
        }),
      });

      const created = (await createResponse.json()) as Channel & { message?: string };

      if (!createResponse.ok || !created.id) {
        throw new Error(created.message || "Unable to add Telegram channel.");
      }

      const testResponse = await fetch(
        `${API_URL}/automation/channels/${created.id}/test`,
        { method: "POST" },
      );
      const tested = (await testResponse.json()) as {
        channel?: Channel;
        message?: string;
      };

      if (!testResponse.ok || !tested.channel) {
        throw new Error(tested.message || "Telegram channel test failed.");
      }

      await load();
      setTelegramForm({ brandId: "", name: "", chatId: "", botToken: "" });
      setShowTelegramForm(false);
      setMessage(`Telegram channel “${tested.channel.name}” connected.`);
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Unable to connect Telegram.",
      );
    } finally {
      setConnectingTelegram(false);
    }
  }

  async function verifyTelegramBot() {
    if (!telegramForm.botToken.trim()) {
      setError("Paste the Bot Token first.");
      return;
    }

    setVerifyingTelegram(true);
    setVerifiedTelegramBot(null);
    setError("");

    try {
      const response = await fetch(`${API_URL}/automation/telegram/inspect-bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: telegramForm.botToken.trim() }),
      });
      const bot = (await response.json()) as {
        name?: string;
        username?: string | null;
        message?: string;
      };

      if (!response.ok || !bot.name) {
        throw new Error(bot.message || "Bot Token is invalid.");
      }

      setVerifiedTelegramBot({ name: bot.name, username: bot.username ?? null });
      setTelegramForm((current) => ({
        ...current,
        name: current.name || bot.name || "Telegram Channel",
      }));
    } catch (verifyError) {
      setError(
        verifyError instanceof Error ? verifyError.message : "Unable to verify Bot.",
      );
    } finally {
      setVerifyingTelegram(false);
    }
  }

  async function selectPublishingAccount(
    channel: Channel,
    accountId: string,
  ) {
    setActiveChannelAction(`${channel.id}:publishing-account`);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/channels/${channel.id}/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPrimary: true }),
        },
      );

      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(
          body.message || "Unable to select the publishing account.",
        );
      }

      await load();
      setMessage(
        `${channel.name} will publish with the selected Facebook account.`,
      );
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "Unable to select the publishing account.",
      );
    } finally {
      setActiveChannelAction(null);
    }
  }

  async function selectPublishingMethod(
    channel: Channel,
    publishingPreference:
      | "AUTOMATIC"
      | "NATIVE_API"
      | "BROWSER_RUNTIME",
  ) {
    setActiveChannelAction(
      `${channel.id}:publishing-method`,
    );
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${channel.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            publishingPreference,
          }),
        },
      );

      const body = (await response
        .json()
        .catch(() => ({}))) as {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(
          body.message ||
            "Unable to select publishing method.",
        );
      }

      await load();
      setMessage(
        `${channel.name} publishing method updated.`,
      );
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "Unable to select publishing method.",
      );
    } finally {
      setActiveChannelAction(null);
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

            <button
              type="button"
              onClick={() => setShowTelegramForm((current) => !current)}
            >
              + Add Telegram
            </button>

            <a href="/automation">
              Open automation
            </a>
          </div>
        </header>

        {showTelegramForm ? (
          <div className={styles.telegramConnectForm}>
            <div className={styles.telegramGuideHeader}>
              <div><b>1</b><span>Verify Bot</span></div>
              <i>→</i>
              <div><b>2</b><span>Add channel</span></div>
              <i>→</i>
              <div><b>3</b><span>Auto-test</span></div>
            </div>

            <div className={styles.telegramBotStep}>
              <div>
                <strong>Connect your Telegram Bot</strong>
                <p>
                  Create or open a bot in @BotFather, copy its token and paste it below.
                  Atlas only stores it after the channel connection succeeds.
                </p>
              </div>

              <div className={styles.telegramTokenRow}>
                <input
                  type="password"
                  value={telegramForm.botToken}
                  placeholder="Paste Bot Token"
                  onChange={(event) => {
                    setVerifiedTelegramBot(null);
                    setTelegramForm((current) => ({
                      ...current,
                      botToken: event.target.value,
                    }));
                  }}
                />
                <button
                  type="button"
                  onClick={() => void verifyTelegramBot()}
                  disabled={verifyingTelegram}
                >
                  {verifyingTelegram ? "Verifying..." : "Verify Bot"}
                </button>
              </div>

              {verifiedTelegramBot ? (
                <div className={styles.verifiedTelegramBot}>
                  <span>✓</span>
                  <div>
                    <strong>{verifiedTelegramBot.name}</strong>
                    <small>
                      {verifiedTelegramBot.username
                        ? `@${verifiedTelegramBot.username}`
                        : "Verified Telegram Bot"}
                    </small>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={styles.formGrid}>
              <label>
                <span>Brand</span>
                <select
                  value={telegramForm.brandId || activeBrand?.id || ""}
                  onChange={(event) =>
                    setTelegramForm((current) => ({
                      ...current,
                      brandId: event.target.value,
                    }))
                  }
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Channel name</span>
                <input
                  value={telegramForm.name}
                  placeholder="MGM Telegram Channel"
                  onChange={(event) =>
                    setTelegramForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                <span>Chat ID / @channel</span>
                <input
                  value={telegramForm.chatId}
                  placeholder="-100... or @channel"
                  onChange={(event) =>
                    setTelegramForm((current) => ({
                      ...current,
                      chatId: event.target.value,
                    }))
                  }
                />
              </label>

              <div className={styles.telegramAdminHint}>
                <strong>Before connecting</strong>
                <span>Add this Bot to the target channel as an administrator with permission to post messages.</span>
              </div>
            </div>

            <div className={styles.telegramFormActions}>
              <button type="button" onClick={() => setShowTelegramForm(false)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void connectTelegram()}
                disabled={connectingTelegram || !verifiedTelegramBot}
              >
                {connectingTelegram ? "Connecting..." : "Connect Telegram"}
              </button>
            </div>
          </div>
        ) : null}

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

                {channel.platform === "FACEBOOK" ? (
                  <section className={styles.browserRuntimeSummary}>
                    <label>
                      <span>Publishing method</span>
                      <select
                        value={
                          channel.publishingPreference ||
                          "AUTOMATIC"
                        }
                        disabled={channelBusy}
                        onChange={(event) =>
                          void selectPublishingMethod(
                            channel,
                            event.target.value as
                              | "AUTOMATIC"
                              | "NATIVE_API"
                              | "BROWSER_RUNTIME",
                          )
                        }
                      >
                        <option value="AUTOMATIC">
                          Automatic fallback
                        </option>
                        <option
                          value="NATIVE_API"
                          disabled={!channel.hasAccessToken}
                        >
                          Facebook API
                        </option>
                        <option
                          value="BROWSER_RUNTIME"
                          disabled={
                            !(channel.browserAccounts?.length || 0)
                          }
                        >
                          Cloud Browser
                        </option>
                      </select>
                      <small>
                        Automatic uses Cloud Browser when connected,
                        otherwise Facebook API. Select a fixed method to
                        prevent automatic switching.
                      </small>
                    </label>
                  </section>
                ) : null}

                {channel.platform === "FACEBOOK" ? (
                  channel.primaryBrowserAccount ? (
                    <section className={styles.browserRuntimeSummary}>
                      <div className={styles.browserRuntimeHeader}>
                        <div>
                          <span className={styles.runtimeLabel}>
                            Browser Runtime
                          </span>

                          <strong>
                            {
                              channel.primaryBrowserAccount
                                .displayName
                            }
                          </strong>

                          <small>
                            {
                              channel.primaryBrowserAccount
                                .browserProfileName
                            }
                          </small>
                        </div>

                        <b
                          className={
                            channel.primaryBrowserAccount
                              .health.status ===
                            "HEALTHY"
                              ? styles.runtimeHealthy
                              : channel.primaryBrowserAccount
                                    .health.status ===
                                  "WARNING"
                                ? styles.runtimeWarning
                                : styles.runtimeCritical
                          }
                        >
                          {
                            channel.primaryBrowserAccount
                              .health.score
                          }
                          {" · "}
                          {
                            channel.primaryBrowserAccount
                              .health.status
                          }
                        </b>
                      </div>

                      <div className={styles.browserRuntimeGrid}>
                        <div>
                          <span>Managed by</span>
                          <strong>
                            {
                              channel.managedBy
                                ?.displayName ||
                              channel.primaryBrowserAccount
                                .displayName
                            }
                          </strong>
                        </div>

                        <div>
                          <span>Publishing mode</span>
                          <strong>
                            Browser Runtime
                          </strong>
                        </div>

                        <div>
                          <span>Login</span>
                          <strong>
                            {channel.primaryBrowserAccount.loginStatus.replaceAll(
                              "_",
                              " ",
                            )}
                          </strong>
                        </div>

                        <div>
                          <span>Cookie</span>
                          <strong>
                            {channel.primaryBrowserAccount.cookieStatus.replaceAll(
                              "_",
                              " ",
                            )}
                          </strong>
                        </div>

                        <div>
                          <span>Proxy</span>
                          <strong>
                            {
                              channel.primaryBrowserAccount
                                .proxyType
                            }
                            {channel.primaryBrowserAccount
                              .proxyCountry
                              ? ` · ${channel.primaryBrowserAccount.proxyCountry}`
                              : ""}
                          </strong>
                        </div>

                        <div>
                          <span>Current IP</span>
                          <strong>
                            {
                              channel.primaryBrowserAccount
                                .lastKnownIp ||
                              "Not checked"
                            }
                          </strong>
                        </div>
                      </div>

                      {(channel.browserAccounts?.length || 0) > 0 ? (
                        <label>
                          <span>Account used for publishing</span>
                          <select
                            value={channel.primaryBrowserAccount.id}
                            disabled={
                              channelBusy ||
                              (channel.browserAccounts?.length || 0) < 2
                            }
                            onChange={(event) =>
                              void selectPublishingAccount(
                                channel,
                                event.target.value,
                              )
                            }
                          >
                            {channel.browserAccounts?.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.displayName} · {account.loginStatus.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                          <small>
                            {(channel.browserAccounts?.length || 0) > 1
                              ? "This Page is connected to more than one Facebook login. Choose which account Atlas should use by default when publishing."
                              : "Only one Facebook login is currently connected to this Page. Connect the same Page from another Browser Account to enable switching."}
                          </small>
                        </label>
                      ) : null}

                      <div className={styles.browserRuntimeActions}>
                        <button
                          type="button"
                          disabled={channelBusy}
                          onClick={() =>
                            void openBrowserAccount(
                              channel,
                              channel.primaryBrowserAccount!.id,
                            )
                          }
                        >
                          {activeChannelAction === `${channel.id}:open-browser`
                            ? "Opening..."
                            : "Open Browser"}
                        </button>

                        <a
                          href={`/automation/browser-accounts?accountId=${encodeURIComponent(
                            channel.primaryBrowserAccount.id,
                          )}`}
                        >
                          Manage Browser Account
                        </a>

                        <a
                          href="/automation/browser-pool"
                        >
                          View Browser Pool
                        </a>
                      </div>

                      <p className={styles.runtimeNotice}>
                        Login, cookies and proxy are controlled
                        by this Browser Account. No separate
                        Channel login is required.
                      </p>
                    </section>
                  ) : (
                    <section className={styles.legacyRuntimePanel}>
                      <div className={styles.legacyRuntimeNotice}>
                        <strong>
                          Legacy Channel Runtime
                        </strong>

                        <span>
                          This Facebook Page is not linked to
                          a Browser Account yet. Link it before
                          migrating login and proxy management.
                        </span>

                        {(() => {
                          const eligibleAccounts = browserAccounts.filter(
                            (account) =>
                              account.platform === "FACEBOOK" &&
                              (!channel.brandId ||
                                account.brandId === channel.brandId),
                          );

                          return eligibleAccounts.length ? (
                            <div className={styles.browserLinkControls}>
                              <select
                                aria-label={`Browser Account for ${channel.name}`}
                                value={browserAccountSelections[channel.id] || ""}
                                disabled={channelBusy}
                                onChange={(event) =>
                                  setBrowserAccountSelections((current) => ({
                                    ...current,
                                    [channel.id]: event.target.value,
                                  }))
                                }
                              >
                                <option value="">Select Browser Account</option>
                                {eligibleAccounts.map((account) => (
                                  <option key={account.id} value={account.id}>
                                    {account.displayName} ·{" "}
                                    {account.loginStatus.replaceAll("_", " ")}
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                disabled={
                                  channelBusy ||
                                  !browserAccountSelections[channel.id]
                                }
                                onClick={() => void linkBrowserAccount(channel)}
                              >
                                {activeChannelAction === `${channel.id}:link-browser`
                                  ? "Linking..."
                                  : "Link Browser Account"}
                              </button>
                            </div>
                          ) : (
                            <a href="/automation/browser-accounts">
                              Create Browser Account
                            </a>
                          );
                        })()}
                      </div>

                      <RuntimeProfileEditor
                        channelId={channel.id}
                      />
                    </section>
                  )
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
                  ) : (
                    <button
                      type="button"
                      onClick={() => void testChannel(channel)}
                      disabled={channelBusy}
                    >
                      {activeChannelAction === `${channel.id}:test`
                        ? "Testing..."
                        : "Test"}
                    </button>
                  )}

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
