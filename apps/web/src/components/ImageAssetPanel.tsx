"use client";

import { useMemo, useState } from "react";
import styles from "./ImageAssetPanel.module.css";

import { API_URL } from "@/lib/api";

type ImageAsset = {
  id: string;
  name: string;
  url: string;
  prompt: string | null;
  provider: string | null;
  width: number | null;
  height: number | null;
  campaign: {
    id: string;
    name: string;
  } | null;
};

type GenerateResponse = {
  asset: ImageAsset;
  generation: {
    model: string;
    size: string;
    quality: string;
  };
};

type ImageVersion = {
  number: number;
  asset: ImageAsset;
  revision: string;
};

const REVISION_PRESETS = [
  {
    label: "Brighter",
    instruction:
      "Make the overall image brighter, cleaner and more visually vibrant while preserving the original concept.",
  },
  {
    label: "More cinematic",
    instruction:
      "Make the image more cinematic with stronger depth, lighting and premium visual composition.",
  },
  {
    label: "Smaller logo",
    instruction:
      "Keep the official brand logo smaller and more unobtrusive without removing it.",
  },
  {
    label: "Daytime",
    instruction:
      "Change the scene to a natural daytime setting with attractive daylight.",
  },
  {
    label: "More emotional",
    instruction:
      "Increase the emotional impact through natural expressions, atmosphere and visual storytelling.",
  },
  {
    label: "Cleaner layout",
    instruction:
      "Simplify the composition, reduce clutter and create a cleaner premium layout.",
  },
];

export function ImageAssetPanel({
  prompt,
  topic,
  campaignId,
  historyId,
}: {
  prompt: string;
  topic: string;
  campaignId?: string;
  historyId?: string;
}) {
  const [size, setSize] = useState("1024x1536");
  const [quality, setQuality] = useState("medium");

  const [logoMode, setLogoMode] = useState<
    "AUTO" | "ALWAYS" | "NEVER"
  >("AUTO");

  const [versions, setVersions] = useState<ImageVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState(0);

  const [revision, setRevision] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const [message, setMessage] = useState(
    prompt
      ? "Image prompt is ready."
      : "Generate the content package first.",
  );

  const asset =
    versions.find(
      (version) => version.number === selectedVersion,
    )?.asset ?? null;

  const latestVersionNumber = useMemo(
    () =>
      versions.reduce(
        (highest, version) =>
          Math.max(highest, version.number),
        0,
      ),
    [versions],
  );

  function buildGenerationPrompt(
    revisionRequest?: string,
  ) {
    const cleanRevision =
      revisionRequest?.trim();

    if (!cleanRevision) {
      return prompt.trim();
    }

    return [
      prompt.trim(),
      "",
      "REVISION REQUEST:",
      cleanRevision,
      "",
      "Create a clearly improved new version.",
      "Preserve the original concept, key subject, intended message, composition logic and important brand requirements unless the revision request explicitly asks to change them.",
      "Do not create an unrelated visual.",
    ].join("\n");
  }

  async function generateImage(
    revisionRequest?: string,
  ) {
    if (!prompt.trim()) {
      setMessage(
        "Generate the content package before creating an image.",
      );
      return;
    }

    if (!historyId) {
      setMessage(
        "A saved Content History record is required.",
      );
      return;
    }

    const cleanRevision =
      revisionRequest?.trim() ?? "";

    const nextVersion =
      latestVersionNumber + 1;

    setIsGenerating(true);

    setMessage(
      nextVersion === 1
        ? "Atlas is generating and saving the image..."
        : `Atlas is generating Version ${nextVersion}...`,
    );

    try {
      const response = await fetch(
        `${API_URL}/asset-images/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt:
              buildGenerationPrompt(cleanRevision),
            name:
              nextVersion === 1
                ? topic || "Atlas campaign image"
                : `${
                    topic || "Atlas campaign image"
                  } · Version ${nextVersion}`,
            campaignId:
              campaignId || undefined,
            historyId,
            platform: "Multi-platform",
            size,
            quality,
            logoMode,
          }),
        },
      );

      const data =
        (await response.json()) as
          | GenerateResponse
          | { message?: string };

      if (
        !response.ok ||
        !("asset" in data)
      ) {
        throw new Error(
          "message" in data &&
          data.message
            ? data.message
            : "Unable to generate image.",
        );
      }

      const newVersion: ImageVersion = {
        number: nextVersion,
        asset: data.asset,
        revision: cleanRevision,
      };

      setVersions((current) => [
        ...current,
        newVersion,
      ]);

      setSelectedVersion(nextVersion);
      setRevision("");

      setMessage(
        nextVersion === 1
          ? "Image generated and saved to Asset Library."
          : `Version ${nextVersion} generated and saved. Previous versions remain available.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to generate image.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function applyPreset(
    instruction: string,
  ) {
    setRevision((current) =>
      current.trim()
        ? `${current.trim()}\n${instruction}`
        : instruction,
    );
  }

  async function downloadAsset(
    currentAsset: ImageAsset,
  ) {
    try {
      const response =
        await fetch(currentAsset.url);

      if (!response.ok) {
        throw new Error(
          "Unable to download image.",
        );
      }

      const blob =
        await response.blob();

      const blobUrl =
        URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = blobUrl;
      link.download =
        `${currentAsset.name || "atlas-image"}.png`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(blobUrl);
    } catch {
      setMessage(
        "Unable to download image.",
      );
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <span>AI Image</span>
          <h3>Generate campaign visual</h3>
        </div>

        <a href="/assets">
          Open Asset Library
        </a>
      </div>

      <div className={styles.controls}>
        <label>
          <span>Size</span>

          <select
            value={size}
            onChange={(event) =>
              setSize(event.target.value)
            }
          >
            <option value="1024x1536">
              Portrait · 1024×1536
            </option>

            <option value="1024x1024">
              Square · 1024×1024
            </option>

            <option value="1536x1024">
              Landscape · 1536×1024
            </option>
          </select>
        </label>

        <label>
          <span>Quality</span>

          <select
            value={quality}
            onChange={(event) =>
              setQuality(event.target.value)
            }
          >
            <option value="low">
              Low
            </option>

            <option value="medium">
              Medium
            </option>

            <option value="high">
              High
            </option>

            <option value="auto">
              Auto
            </option>
          </select>
        </label>

        <label>
          <span>Brand logo</span>

          <select
            value={logoMode}
            onChange={(event) =>
              setLogoMode(
                event.target.value as
                  | "AUTO"
                  | "ALWAYS"
                  | "NEVER",
              )
            }
          >
            <option value="AUTO">
              Auto · Recommended
            </option>

            <option value="ALWAYS">
              Always include
            </option>

            <option value="NEVER">
              Never include
            </option>
          </select>
        </label>

        <button
          type="button"
          onClick={() =>
            void generateImage()
          }
          disabled={
            isGenerating ||
            !prompt ||
            !historyId
          }
        >
          {isGenerating
            ? "Generating image..."
            : versions.length
              ? "◇ Generate another concept"
              : "◇ Generate and save"}
        </button>
      </div>

      <p className={styles.message}>
        {message}
      </p>

      {versions.length ? (
        <div className={styles.versionBar}>
          <div>
            <span>Image versions</span>

            <small>
              {versions.length} saved
            </small>
          </div>

          <div className={styles.versionButtons}>
            {versions.map((version) => (
              <button
                type="button"
                key={version.number}
                className={
                  selectedVersion ===
                  version.number
                    ? styles.activeVersion
                    : ""
                }
                onClick={() =>
                  setSelectedVersion(
                    version.number,
                  )
                }
              >
                V{version.number}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {asset ? (
        <>
          <div className={styles.result}>
            <img
              src={asset.url}
              alt={asset.name}
            />

            <div>
              <span>
                Saved asset · Version{" "}
                {selectedVersion}
              </span>

              <h3>{asset.name}</h3>

              <p>
                {asset.provider ||
                  "OpenAI image model"}{" "}
                · {asset.width}×
                {asset.height}
              </p>

              {versions.find(
                (version) =>
                  version.number ===
                  selectedVersion,
              )?.revision ? (
                <p className={styles.revisionSummary}>
                  Revision:{" "}
                  {
                    versions.find(
                      (version) =>
                        version.number ===
                        selectedVersion,
                    )?.revision
                  }
                </p>
              ) : null}

              <div className={styles.actions}>
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  View full image
                </a>

                <button
                  type="button"
                  onClick={() =>
                    void downloadAsset(asset)
                  }
                >
                  Download PNG
                </button>

                <a href="/assets">
                  View in Library
                </a>
              </div>
            </div>
          </div>

          <section className={styles.revisionPanel}>
            <div className={styles.revisionHeader}>
              <div>
                <span>
                  Improve this image
                </span>

                <h4>
                  Tell Atlas what to change
                </h4>
              </div>

              <small>
                A new Asset Library version
                will be created.
              </small>
            </div>

            <div className={styles.presetGrid}>
              {REVISION_PRESETS.map(
                (preset) => (
                  <button
                    type="button"
                    key={preset.label}
                    onClick={() =>
                      applyPreset(
                        preset.instruction,
                      )
                    }
                    disabled={isGenerating}
                  >
                    {preset.label}
                  </button>
                ),
              )}
            </div>

            <textarea
              value={revision}
              onChange={(event) =>
                setRevision(
                  event.target.value,
                )
              }
              placeholder="Example: Make the colours brighter, reduce the logo size, change to a daytime scene and avoid showing people from behind."
              rows={5}
              disabled={isGenerating}
            />

            <div className={styles.revisionActions}>
              <button
                type="button"
                className={styles.clearButton}
                onClick={() =>
                  setRevision("")
                }
                disabled={
                  isGenerating ||
                  !revision
                }
              >
                Clear
              </button>

              <button
                type="button"
                className={styles.regenerateButton}
                onClick={() =>
                  void generateImage(
                    revision,
                  )
                }
                disabled={
                  isGenerating ||
                  !revision.trim()
                }
              >
                {isGenerating
                  ? "Generating new version..."
                  : `Generate Version ${
                      latestVersionNumber + 1
                    }`}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
