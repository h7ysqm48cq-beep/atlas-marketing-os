"use client";

import { useState } from "react";
import styles from "./ImageAssetPanel.module.css";

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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
  const [asset, setAsset] = useState<ImageAsset | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState(
    prompt
      ? "Image prompt is ready."
      : "Generate the content package first.",
  );

  async function generateImage() {
    if (!prompt.trim()) {
      setMessage("Generate the content package before creating an image.");
      return;
    }

    if (!historyId) {
      setMessage("A saved Content History record is required.");
      return;
    }

    setIsGenerating(true);
    setMessage("Atlas is generating and saving the image...");

    try {
      const response = await fetch(
        `${API_BASE_URL}/asset-images/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            name: topic || "Atlas campaign image",
            campaignId: campaignId || undefined,
            historyId,
            platform: "Multi-platform",
            size,
            quality,
          }),
        },
      );

      const data = (await response.json()) as
        | GenerateResponse
        | { message?: string };

      if (!response.ok || !("asset" in data)) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to generate image.",
        );
      }

      setAsset(data.asset);
      setMessage("Image generated and saved to Asset Library.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to generate image.",
      );
    } finally {
      setIsGenerating(false);
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

        <button
          onClick={() => void generateImage()}
          disabled={isGenerating || !prompt || !historyId}
        >
          {isGenerating ? "Generating image..." : "◇ Generate and save"}
        </button>
      </div>

      <p className={styles.message}>{message}</p>

      {asset ? (
        <div className={styles.result}>
          <img src={asset.url} alt={asset.name} />

          <div>
            <span>Saved asset</span>
            <h3>{asset.name}</h3>
            <p>
              {asset.provider || "OpenAI image model"} ·{" "}
              {asset.width}×{asset.height}
            </p>

            <div className={styles.actions}>
  <a href={asset.url} target="_blank" rel="noreferrer">
    View full image
  </a>

  <button
    type="button"
    onClick={async () => {
      try {
        const response = await fetch(asset.url);

        if (!response.ok) {
          throw new Error("Unable to download image.");
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = blobUrl;
        link.download = `${asset.name || "atlas-image"}.png`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(blobUrl);
      } catch {
        setMessage("Unable to download image.");
      }
    }}
  >
    Download PNG
  </button>

  <a href="/assets">View in Library</a>
</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
