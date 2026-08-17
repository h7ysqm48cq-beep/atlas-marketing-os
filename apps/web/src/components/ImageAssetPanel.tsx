"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RuntimeImage } from "./RuntimeImage";
import styles from "./ImageAssetPanel.module.css";

import { API_URL } from "@/lib/api";
import { waitForBackgroundJob } from "@/lib/background-job";
import { saveRemoteFile } from "@/lib/save-file";

const ASSET_IMAGE_JOB_KEY = "atlas-asset-image-background-job";

type LogoMode = "AUTO" | "ALWAYS" | "NEVER";
type LogoPlacement =
  | "AUTO"
  | "TOP_LEFT"
  | "TOP_CENTER"
  | "TOP_RIGHT"
  | "CENTER_LEFT"
  | "CENTER"
  | "CENTER_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_CENTER"
  | "BOTTOM_RIGHT";

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
    logoPlacement?: LogoPlacement;
    logoScale?: number;
    logoOpacity?: number;
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
  autoGenerateRequestId,
  onAutoGenerateSettled,
}: {
  prompt: string;
  topic: string;
  campaignId?: string;
  historyId?: string;

  autoGenerateRequestId?: number;

  onAutoGenerateSettled?: (
    result: {
      requestId: number;
      success: boolean;
      message?: string;
    },
  ) => void;
}) {
  const [size, setSize] = useState("1024x1536");
  const [quality, setQuality] = useState("medium");
  const [logoMode, setLogoMode] = useState<LogoMode>("AUTO");
  const [logoPlacement, setLogoPlacement] =
    useState<LogoPlacement>("AUTO");
  const [logoScale, setLogoScale] = useState(1);
  const [logoOpacity, setLogoOpacity] = useState(1);

  const [versions, setVersions] = useState<ImageVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState(0);
  const [revision, setRevision] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handledAutoRequestRef =
    useRef<number | null>(null);

  const [message, setMessage] = useState(
    prompt ? "Image prompt is ready." : "Generate the content package first.",
  );

  const asset =
    versions.find((version) => version.number === selectedVersion)?.asset ??
    null;

  const latestVersionNumber = useMemo(
    () =>
      versions.reduce(
        (highest, version) => Math.max(highest, version.number),
        0,
      ),
    [versions],
  );

  function buildGenerationPrompt(revisionRequest?: string) {
    const cleanRevision = revisionRequest?.trim();

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
    externalRequestId?: number,
  ) {

    let generationSucceeded =
      false;

    let generationError:
      string | undefined;
    if (!prompt.trim()) {

      const errorMessage =
        "Generate the content package before creating an image.";

      setMessage(
        errorMessage,
      );

      if (
        externalRequestId
      ) {
        onAutoGenerateSettled?.({
          requestId:
            externalRequestId,

          success:
            false,

          message:
            errorMessage,
        });
      }

      return;
    }

    if (!historyId) {

      const errorMessage =
        "A saved Content History record is required.";

      setMessage(
        errorMessage,
      );

      if (
        externalRequestId
      ) {
        onAutoGenerateSettled?.({
          requestId:
            externalRequestId,

          success:
            false,

          message:
            errorMessage,
        });
      }

      return;
    }

    const cleanRevision = revisionRequest?.trim() ?? "";
    const nextVersion = latestVersionNumber + 1;

    setIsGenerating(true);
    setMessage(
      nextVersion === 1
        ? "Atlas is generating and saving the image..."
        : `Atlas is generating Version ${nextVersion}...`,
    );

    try {
      const response = await fetch(`${API_URL}/asset-images/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: buildGenerationPrompt(cleanRevision),
          name:
            nextVersion === 1
              ? topic || "Atlas campaign image"
              : `${topic || "Atlas campaign image"} · Version ${nextVersion}`,
          campaignId: campaignId || undefined,
          historyId,
          platform: "Multi-platform",
          size,
          quality,
          logoMode,
          logoPlacement,
          logoScale,
          logoOpacity,
        }),
      });

      const job = (await response.json()) as {
        id?: string;
        status?: string;
        message?: string;
        error?: string;
      };

      if (!response.ok || !job.id) {
        throw new Error(
          job.message || job.error || "Unable to create background image job.",
        );
      }

      window.localStorage.setItem(ASSET_IMAGE_JOB_KEY, job.id);

      const data = await waitForBackgroundJob<GenerateResponse>(
        `${API_URL}/asset-images/jobs/${job.id}`,
        {
          intervalMs: 2000,
          timeoutMs: 20 * 60 * 1000,
        },
      );

      window.localStorage.removeItem(ASSET_IMAGE_JOB_KEY);

      if (!("asset" in data)) {
        throw new Error("Unable to generate image.");
      }

      const newVersion: ImageVersion = {
        number: nextVersion,
        asset: data.asset,
        revision: cleanRevision,
      };

      setVersions((current) => [...current, newVersion]);
      setSelectedVersion(nextVersion);
      setRevision("");

      generationSucceeded =
        true;

      setMessage(
        nextVersion === 1
          ? "Image generated and saved to Asset Library."
          : `Version ${nextVersion} generated and saved. Previous versions remain available.`,
      );
    } catch (error) {

      generationError =
        error instanceof Error
          ? error.message
          : "Unable to generate image.";

      setMessage(
        generationError,
      );

    } finally {

      setIsGenerating(
        false,
      );

      if (
        externalRequestId
      ) {

        onAutoGenerateSettled?.({
          requestId:
            externalRequestId,

          success:
            generationSucceeded,

          message:
            generationError,
        });

      }

    }
  }


  /*
   * Formal external image-generation bridge.
   *
   * No querySelector.
   * No simulated click.
   */
  useEffect(
    () => {

      const requestId =
        autoGenerateRequestId;


      if (
        !requestId
        ||
        handledAutoRequestRef.current
          ===
          requestId
        ||
        isGenerating
      ) {
        return;
      }


      handledAutoRequestRef.current =
        requestId;


      void generateImage(
        undefined,
        requestId,
      );

    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Auto-generation is deduplicated by request id; callback identity must not retrigger it.
    [
      autoGenerateRequestId,
      isGenerating,
      prompt,
      historyId,
    ],
  );

  function applyPreset(instruction: string) {
    setRevision((current) =>
      current.trim() ? `${current.trim()}\n${instruction}` : instruction,
    );
  }

  async function downloadAsset(currentAsset: ImageAsset) {
    try {
      const result = await saveRemoteFile({
        url: currentAsset.url,
        filename: `${currentAsset.name || "atlas-image"}.png`,
        mimeType: "image/png",
        title: currentAsset.name,
      });
      setMessage(
        result === "shared"
          ? "Choose Save Image to store it on your phone."
          : "Image downloaded.",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("Unable to save image.");
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <span>AI Image</span>
          <h3>Generate campaign visual</h3>
        </div>

        <a href="/assets">Open Asset Library</a>
      </div>

      <div className={styles.controls}>
        <label>
          <span>Size</span>
          <select
            value={size}
            onChange={(event) => setSize(event.target.value)}
          >
            <option value="1024x1536">Portrait · 1024×1536</option>
            <option value="1024x1024">Square · 1024×1024</option>
            <option value="1536x1024">Landscape · 1536×1024</option>
          </select>
        </label>

        <label>
          <span>Quality</span>
          <select
            value={quality}
            onChange={(event) => setQuality(event.target.value)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="auto">Auto</option>
          </select>
        </label>

        <label>
          <span>Brand logo</span>
          <select
            value={logoMode}
            onChange={(event) => setLogoMode(event.target.value as LogoMode)}
          >
            <option value="AUTO">Auto · Recommended</option>
            <option value="ALWAYS">Always include</option>
            <option value="NEVER">Never include</option>
          </select>
        </label>

        <label>
          <span>Logo position</span>
          <select
            value={logoPlacement}
            onChange={(event) =>
              setLogoPlacement(event.target.value as LogoPlacement)
            }
            disabled={logoMode === "NEVER"}
          >
            <option value="AUTO">Auto · Recommended</option>
            <option value="BOTTOM_LEFT">Bottom left</option>
            <option value="BOTTOM_CENTER">Bottom center</option>
            <option value="BOTTOM_RIGHT">Bottom right</option>
            <option value="TOP_LEFT">Top left</option>
            <option value="TOP_CENTER">Top center</option>
            <option value="TOP_RIGHT">Top right</option>
            <option value="CENTER_LEFT">Centre left</option>
            <option value="CENTER">Centre</option>
            <option value="CENTER_RIGHT">Centre right</option>
          </select>
        </label>

        <label>
          <span>Logo size</span>
          <select
            value={logoScale}
            onChange={(event) => setLogoScale(Number(event.target.value))}
            disabled={logoMode === "NEVER"}
          >
            <option value={0.7}>Small</option>
            <option value={0.85}>Compact</option>
            <option value={1}>Standard · Recommended</option>
            <option value={1.2}>Large</option>
            <option value={1.4}>Extra large</option>
          </select>
        </label>

        <label>
          <span>Logo opacity</span>
          <select
            value={logoOpacity}
            onChange={(event) => setLogoOpacity(Number(event.target.value))}
            disabled={logoMode === "NEVER"}
          >
            <option value={1}>100% · Solid</option>
            <option value={0.9}>90% · Recommended</option>
            <option value={0.75}>75%</option>
            <option value={0.6}>60% · Subtle</option>
            <option value={0.4}>40% · Watermark</option>
          </select>
        </label>

        <button
          type="button"
          onClick={() => void generateImage()}
          disabled={isGenerating || !prompt || !historyId}
        >
          {isGenerating
            ? "Generating image..."
            : versions.length
              ? "◇ Generate another concept"
              : "◇ Generate and save"}
        </button>
      </div>

      <p className={styles.message}>{message}</p>

      {versions.length ? (
        <div className={styles.versionBar}>
          <div>
            <span>Image versions</span>
            <small>{versions.length} saved</small>
          </div>

          <div className={styles.versionButtons}>
            {versions.map((version) => (
              <button
                type="button"
                key={version.number}
                className={
                  selectedVersion === version.number ? styles.activeVersion : ""
                }
                onClick={() => setSelectedVersion(version.number)}
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
            <RuntimeImage
              src={asset.url}
              alt={asset.name}
              width={asset.width || undefined}
              height={asset.height || undefined}
            />

            <div>
              <span>Saved asset · Version {selectedVersion}</span>
              <h3>{asset.name}</h3>
              <p>
                {asset.provider || "OpenAI image model"} · {asset.width}×
                {asset.height}
              </p>

              {versions.find((version) => version.number === selectedVersion)
                ?.revision ? (
                <p className={styles.revisionSummary}>
                  Revision:{" "}
                  {
                    versions.find(
                      (version) => version.number === selectedVersion,
                    )?.revision
                  }
                </p>
              ) : null}

              <div className={styles.actions}>
                <a href={asset.url} target="_blank" rel="noreferrer">
                  View full image
                </a>

                <button type="button" onClick={() => void downloadAsset(asset)}>
                  Save image
                </button>

                <a href="/assets">View in Library</a>
              </div>
            </div>
          </div>

          <section className={styles.revisionPanel}>
            <div className={styles.revisionHeader}>
              <div>
                <span>Improve this image</span>
                <h4>Tell Atlas what to change</h4>
              </div>

              <small>A new Asset Library version will be created.</small>
            </div>

            <div className={styles.presetGrid}>
              {REVISION_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.label}
                  onClick={() => applyPreset(preset.instruction)}
                  disabled={isGenerating}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <textarea
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
              placeholder="Example: Make the colours brighter, reduce the logo size, change to a daytime scene and avoid showing people from behind."
              rows={5}
              disabled={isGenerating}
            />

            <div className={styles.revisionActions}>
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => setRevision("")}
                disabled={isGenerating || !revision}
              >
                Clear
              </button>

              <button
                type="button"
                className={styles.regenerateButton}
                onClick={() => void generateImage(revision)}
                disabled={isGenerating || !revision.trim()}
              >
                {isGenerating
                  ? "Generating new version..."
                  : `Generate Version ${latestVersionNumber + 1}`}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
