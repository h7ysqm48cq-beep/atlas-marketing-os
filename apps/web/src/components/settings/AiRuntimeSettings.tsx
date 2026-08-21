"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import styles from "./AiRuntimeSettings.module.css";
import ImageGenerationSettings from "./ImageGenerationSettings";

type AiRuntimeSettingsData = {
  textModel: string;
  imageModel: string;
  imageGenerationInstructions: string;
  imageNegativeInstructions: string;
  embeddingModel: string;
  sportsNewsModel: string;
  aiStudioModel: string;
  aiStudioInstructions: string;
  aiStudioTimeoutMs: number;
  aiStudioRetryLimit: number;
  copilotModel: string;
  copilotInstructions: string;
  copilotKnowledgeLimit: number;
  copilotConversationRecallLimit: number;
  copilotStudioHistoryLimit: number;
  copilotContextMaxChars: number;
};

type ModelFieldKey =
  | "textModel"
  | "imageModel"
  | "embeddingModel"
  | "sportsNewsModel";

const FIELDS: Array<{
  key: ModelFieldKey;
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

export function AiRuntimeSettings({
  section = "all",
}: {
  section?: "all" | "studio" | "copilot";
}) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetch persisted runtime settings when the panel mounts.
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

  function patchNumber(key: keyof AiRuntimeSettingsData, value: number) {
    setSettings((current) =>
      current ? { ...current, [key]: value } : current,
    );
    setMessage("");
    setError("");
  }

  function patchBoolean(key: keyof AiRuntimeSettingsData, value: boolean) {
    setSettings((current) =>
      current ? { ...current, [key]: value } : current,
    );
    setMessage("");
    setError("");
  }

  async function saveSettings() {
    if (!settings) {
      return;
    }

    const payload: AiRuntimeSettingsData = {
      ...settings,
      textModel: settings.textModel.trim(),
      imageModel: settings.imageModel.trim(),
      embeddingModel: settings.embeddingModel.trim(),
      sportsNewsModel: settings.sportsNewsModel.trim(),
      aiStudioModel: settings.aiStudioModel.trim(),
      aiStudioInstructions: settings.aiStudioInstructions.trim(),
      copilotModel: settings.copilotModel.trim(),
      copilotInstructions: settings.copilotInstructions.trim(),
    };

    if (
      [
        payload.textModel,
        payload.imageModel,
        payload.embeddingModel,
        payload.sportsNewsModel,
        payload.aiStudioModel,
        payload.copilotModel,
      ].some((value) => !value)
    ) {
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

  if (!hydrated) {
    return (
      <section className={styles.card}>
        <div className={styles.state}>
          Loading AI Runtime settings...
        </div>
      </section>
    );
  }

  if (loading && !settings) {
    return (
      <section className={styles.card}>
        <ImageGenerationSettings />
        <div className={styles.state}>Loading AI Runtime settings...</div>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <ImageGenerationSettings />

      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AI SYSTEM</p>
          <h2>
            {section === "studio"
              ? "AI Studio Settings"
              : section === "copilot"
                ? "Copilot Settings"
                : "AI Runtime"}
          </h2>
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
          {section === "all" ? <div className={styles.grid}>
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
          </div> : null}

          {section === "all" ? (
            <>
              <h3 className={styles.sectionTitle}>Image Generation Policy</h3>
              <div className={styles.grid}>
                <label className={`${styles.field} ${styles.fullWidth}`}>
                  <span className={styles.label}>Global Image Instructions</span>
                  <span className={styles.description}>
                    Rules appended to every final image-generation request from Studio, Copilot, Sports and Assets.
                  </span>
                  <textarea
                    className={styles.input}
                    rows={6}
                    value={settings.imageGenerationInstructions}
                    onChange={(event) =>
                      patch("imageGenerationInstructions", event.target.value)
                    }
                  />
                </label>

                <label className={`${styles.field} ${styles.fullWidth}`}>
                  <span className={styles.label}>Global Negative Instructions</span>
                  <span className={styles.description}>
                    Objects, styles and visual mistakes every image request should avoid.
                  </span>
                  <textarea
                    className={styles.input}
                    rows={5}
                    value={settings.imageNegativeInstructions}
                    onChange={(event) =>
                      patch("imageNegativeInstructions", event.target.value)
                    }
                  />
                </label>
                <div className={styles.field}>
                  <span className={styles.label}>
                    AI Brand Rendering
                  </span>

                  <span className={styles.description}>
                    Managed by Atlas · Always blocked for official branding.
                    The image model must not generate official logos,
                    brand names, website URLs, branded signatures,
                    watermarks or branded QR codes.
                  </span>

                  <div
                    className={styles.input}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      minHeight: 42,
                      opacity: 0.78,
                      cursor: "default",
                    }}
                  >
                    Official Brand Generation · Disabled
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.label}>
                    Official Branding
                  </span>

                  <span className={styles.description}>
                    Logo and footer rendering are controlled by
                    Brand Signature and Corner Logo settings below.
                    Official logos come only from uploaded Brand assets.
                  </span>

                  <div
                    className={styles.input}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      minHeight: 42,
                      opacity: 0.78,
                      cursor: "default",
                    }}
                  >
                    Managed by Image Generation Settings
                  </div>
                </div>

              </div>
            </>
          ) : null}

          {section !== "copilot" ? <>
          {section === "all" ? <h3 className={styles.sectionTitle}>AI Studio</h3> : null}
          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.label}>AI Studio Model</span>
              <span className={styles.description}>Dedicated model for Studio content generation.</span>
              <input className={styles.input} value={settings.aiStudioModel} onChange={(event) => patch("aiStudioModel", event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Generation Timeout (ms)</span>
              <span className={styles.description}>5,000–180,000 milliseconds per attempt.</span>
              <input className={styles.input} type="number" min={5000} max={180000} value={settings.aiStudioTimeoutMs} onChange={(event) => patchNumber("aiStudioTimeoutMs", Number(event.target.value))} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Retry Limit</span>
              <span className={styles.description}>Automatic retries after a failed generation, from 0–5.</span>
              <input className={styles.input} type="number" min={0} max={5} value={settings.aiStudioRetryLimit} onChange={(event) => patchNumber("aiStudioRetryLimit", Number(event.target.value))} />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span className={styles.label}>AI Studio Instructions</span>
              <span className={styles.description}>Additional global instructions applied to every Studio generation.</span>
              <textarea className={styles.input} rows={5} value={settings.aiStudioInstructions} onChange={(event) => patch("aiStudioInstructions", event.target.value)} />
            </label>
          </div>
          </> : null}

          {section !== "studio" ? <>
          {section === "all" ? <h3 className={styles.sectionTitle}>Copilot</h3> : null}
          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.label}>Copilot Model</span>
              <span className={styles.description}>Dedicated model for Copilot conversations.</span>
              <input className={styles.input} value={settings.copilotModel} onChange={(event) => patch("copilotModel", event.target.value)} />
            </label>
            {[
              ["copilotKnowledgeLimit", "Knowledge Results", 1, 20],
              ["copilotConversationRecallLimit", "Conversation Recall", 1, 20],
              ["copilotStudioHistoryLimit", "Studio History Recall", 1, 20],
              ["copilotContextMaxChars", "Context Character Budget", 1000, 30000],
            ].map(([key, label, min, max]) => (
              <label className={styles.field} key={key as string}>
                <span className={styles.label}>{label as string}</span>
                <span className={styles.description}>Controls how much saved context Copilot can load.</span>
                <input className={styles.input} type="number" min={min as number} max={max as number} value={settings[key as keyof AiRuntimeSettingsData] as number} onChange={(event) => patchNumber(key as keyof AiRuntimeSettingsData, Number(event.target.value))} />
              </label>
            ))}
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span className={styles.label}>Copilot Instructions</span>
              <span className={styles.description}>Additional global instructions applied to every Copilot response.</span>
              <textarea className={styles.input} rows={5} value={settings.copilotInstructions} onChange={(event) => patch("copilotInstructions", event.target.value)} />
            </label>
          </div>
          </> : null}

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
