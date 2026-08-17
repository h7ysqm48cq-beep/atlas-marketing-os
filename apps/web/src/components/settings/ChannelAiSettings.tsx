"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import styles from "./AiRuntimeSettings.module.css";

type Channel = { id: string; name: string; platform: string };
type Override = {
  customInstructions?: string | null;
  morningPrompt?: string | null;
  eveningPrompt?: string | null;
  imagePrompt?: string | null;
  morningImagePrompt?: string | null;
  eveningImagePrompt?: string | null;
};

const fields: Array<[keyof Override, string]> = [
  ["customInstructions", "Channel Instructions"],
  ["morningPrompt", "Morning Prompt"],
  ["eveningPrompt", "Evening Prompt"],
  ["imagePrompt", "Default Image Prompt"],
  ["morningImagePrompt", "Morning Image Prompt"],
  ["eveningImagePrompt", "Evening Image Prompt"],
];

export function ChannelAiSettings() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [settingsResponse, channelsResponse] = await Promise.all([
      fetch(`${API_URL}/sports-news/settings`, { cache: "no-store" }),
      fetch(`${API_URL}/sports-news/channels`, { cache: "no-store" }),
    ]);
    if (!settingsResponse.ok || !channelsResponse.ok) {
      throw new Error("Unable to load channel AI settings.");
    }
    const settings = (await settingsResponse.json()) as {
      channelOverrides?: Record<string, Override>;
    };
    setOverrides(settings.channelOverrides || {});
    setChannels((await channelsResponse.json()) as Channel[]);
  }, []);

  useEffect(() => {
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Load failed."),
    );
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/sports-news/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelOverrides: overrides }),
      });
      if (!response.ok) throw new Error(await response.text());
      setMessage("Channel AI settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CHANNEL AI</p>
          <h2>Channel AI Settings</h2>
          <p className={styles.intro}>Manage channel-specific prompts independently from Sports News.</p>
        </div>
      </div>
      {message ? <div className={styles.success}>{message}</div> : null}
      {channels.map((channel) => (
        <div key={channel.id}>
          <h3 className={styles.sectionTitle}>{channel.name} · {channel.platform}</h3>
          <div className={styles.grid}>
            {fields.map(([key, label]) => (
              <label className={styles.field} key={key}>
                <span className={styles.label}>{label}</span>
                <textarea
                  className={styles.input}
                  rows={4}
                  placeholder="Use the global default"
                  value={overrides[channel.id]?.[key] ?? ""}
                  onChange={(event) =>
                    setOverrides((current) => ({
                      ...current,
                      [channel.id]: {
                        ...(current[channel.id] || {}),
                        [key]: event.target.value || null,
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className={styles.footer}>
        <p>Blank fields continue using the global prompt.</p>
        <div className={styles.actions}>
          <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => void load()}>Reload</button>
          <button className={styles.primaryButton} type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save Channel AI"}</button>
        </div>
      </div>
    </section>
  );
}
