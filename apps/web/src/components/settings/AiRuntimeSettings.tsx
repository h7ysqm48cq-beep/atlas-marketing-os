"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import styles from "./AiRuntimeSettings.module.css";

type AiRuntimeSettingsData = {
  textModel: string;
  imageModel: string;
  embeddingModel: string;
  sportsNewsModel: string;
};

const FIELDS: Array<{
  key: keyof AiRuntimeSettingsData;
  label: string;
  description: string;
  placeholder: string;
}> = [
  {
    key: "textModel",
    label: "Text Model",
    description:
      "Default model used for AI writing, Copilot, planning and text generation.",
    placeholder: "gpt-5.6-luna",
  },
  {
    key: "imageModel",
    label: "Image Model",
    description:
      "Default model used for AI image generation and image editing.",
    placeholder: "gpt-image-2",
  },
  {
    key: "embeddingModel",
    label: "Embedding Model",
    description:
      "Model used for knowledge retrieval, semantic search and embeddings.",
    placeholder: "text-embedding-3-large",
  },
  {
    key: "sportsNewsModel",
    label: "M Sports News Model",
    description: "Default AI model dedicated to M Sports News generation.",
    placeholder: "gpt-5.6-luna",
  },
];

export function AiRuntimeSettings() {
  const [settings, setSettings] = useState<AiRuntimeSettingsData | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/ai-runtime`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to load AI Runtime settings.");
      }

      const data = (await response.json()) as AiRuntimeSettingsData;

      setSettings(data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load AI Runtime settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function patch(key: keyof AiRuntimeSettingsData, value: string) {
    setSettings((current) =>
      current
        ? {
            ...current,
            [key]: value,
          }
        : current,
    );

    setMessage("");
    setError("");
  }

  async function saveSettings() {
    if (!settings) {
      return;
    }

    const payload: AiRuntimeSettingsData = {
      textModel: settings.textModel.trim(),
      imageModel: settings.imageModel.trim(),
      embeddingModel: settings.embeddingModel.trim(),
      sportsNewsModel: settings.sportsNewsModel.trim(),
    };

    if (Object.values(payload).some((value) => !value)) {
      setError("Model names cannot be empty.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`${API_URL}/ai-runtime`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.message || "Unable to save AI Runtime settings.");
      }

      setSettings(body as AiRuntimeSettingsData);
      setMessage("AI Runtime settings saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save AI Runtime settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) {
    return (
      <section className={styles.card}>
        <div className={styles.state}>Loading AI Runtime settings...</div>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AI SYSTEM</p>
          <h2>AI Runtime</h2>
          <p className={styles.intro}>
            Control the models Atlas uses at runtime without changing
            environment variables or source code.
          </p>
        </div>

        <div className={styles.status}>
          <span className={styles.statusDot} />
          Runtime connected
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {message ? <div className={styles.success}>{message}</div> : null}

      {settings ? (
        <>
          <div className={styles.grid}>
            {FIELDS.map((field) => (
              <label className={styles.field} key={field.key}>
                <span className={styles.label}>{field.label}</span>

                <span className={styles.description}>{field.description}</span>

                <input
                  className={styles.input}
                  value={settings[field.key]}
                  placeholder={field.placeholder}
                  spellCheck={false}
                  onChange={(event) => patch(field.key, event.target.value)}
                />
              </label>
            ))}
          </div>

          <div className={styles.footer}>
            <p>
              Changes apply to services wired to the central AI Runtime
              configuration.
            </p>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => void loadSettings()}
              >
                Reload
              </button>

              <button
                type="button"
                className={styles.primaryButton}
                disabled={saving}
                onClick={() => void saveSettings()}
              >
                {saving ? "Saving..." : "Save AI Runtime"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.state}>AI Runtime settings unavailable.</div>
      )}
    </section>
  );
}
