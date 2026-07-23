"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./CampaignAssets.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type AssetType =
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "TEMPLATE";

type CampaignAsset = {
  id: string;
  name: string;
  type: AssetType;
  provider: string | null;
  platform: string | null;
  prompt: string | null;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  isFavorite: boolean;
  createdAt: string;
  campaign: {
    id: string;
    name: string;
  } | null;
  history: {
    id: string;
    topic: string;
  } | null;
};

export function CampaignAssets({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const [assets, setAssets] = useState<CampaignAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState(
    "Loading campaign assets...",
  );

  useEffect(() => {
    void loadAssets();
  }, [campaignId]);

  const stats = useMemo(
    () => ({
      total: assets.length,
      images: assets.filter(
        (asset) => asset.type === "IMAGE",
      ).length,
      videos: assets.filter(
        (asset) => asset.type === "VIDEO",
      ).length,
      other: assets.filter(
        (asset) =>
          asset.type === "DOCUMENT" ||
          asset.type === "TEMPLATE",
      ).length,
    }),
    [assets],
  );

  async function loadAssets() {
    setIsLoading(true);
    setMessage("Loading campaign assets...");

    try {
      const query = new URLSearchParams({
        campaignId,
      });

      const response = await fetch(
        `${API_BASE_URL}/assets?${query.toString()}`,
        {
          cache: "no-store",
        },
      );

      const data = (await response.json()) as
        | CampaignAsset[]
        | { message?: string };

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          !Array.isArray(data) && data.message
            ? data.message
            : "Unable to load campaign assets.",
        );
      }

      setAssets(data);

      setMessage(
        data.length === 0
          ? "No assets are linked to this campaign yet."
          : `${data.length} campaign asset${
              data.length === 1 ? "" : "s"
            } loaded.`,
      );
    } catch (error) {
      setAssets([]);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load campaign assets.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            Campaign Creative Workspace
          </p>

          <h2>Campaign Assets</h2>

          <p>
            View images, videos, documents and templates belonging
            specifically to this campaign.
          </p>
        </div>

        <div className={styles.campaignMeta}>
          <span>{campaignName}</span>
          <strong>
            {isLoading ? "Loading" : `${assets.length} assets`}
          </strong>
        </div>
      </header>

      <section className={styles.stats}>
        <AssetStat label="Total assets" value={stats.total} />
        <AssetStat label="Images" value={stats.images} />
        <AssetStat label="Videos" value={stats.videos} />
        <AssetStat label="Other files" value={stats.other} />
      </section>

      <section className={styles.toolbar}>
        <div>
          <span>Campaign library</span>
          <strong>{message}</strong>
        </div>

        <div className={styles.toolbarActions}>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void loadAssets()}
          >
            {isLoading ? "Loading..." : "Refresh"}
          </button>

          <a
            href={`/assets?campaignId=${encodeURIComponent(
              campaignId,
            )}`}
          >
            Open global library
          </a>
        </div>
      </section>

      {isLoading ? (
        <section className={styles.loadingState}>
          <span className={styles.spinner} />
          <strong>Loading campaign assets</strong>
          <p>
            Atlas is retrieving the creative files connected to this
            campaign.
          </p>
        </section>
      ) : assets.length === 0 ? (
        <section className={styles.emptyState}>
          <span>◇</span>

          <h3>No campaign assets yet</h3>

          <p>
            Save an image, video, document or template with this
            Campaign ID to make it appear here.
          </p>

          <a href="/assets">
            Add an asset in Asset Library
          </a>
        </section>
      ) : (
        <section className={styles.assetGrid}>
          {assets.map((asset) => (
            <article className={styles.assetCard} key={asset.id}>
              <div className={styles.preview}>
                {asset.type === "IMAGE" ? (
                  <img
                    src={asset.thumbnailUrl || asset.url}
                    alt={asset.name}
                  />
                ) : (
                  <div className={styles.filePreview}>
                    <span>{asset.type}</span>
                  </div>
                )}

                {asset.isFavorite ? (
                  <span className={styles.favoriteBadge}>
                    ★
                  </span>
                ) : null}
              </div>

              <div className={styles.assetBody}>
                <div className={styles.assetMeta}>
                  <span>{asset.type}</span>
                  <small>
                    {asset.provider || "Unknown provider"}
                  </small>
                </div>

                <h3>{asset.name}</h3>

                <p>
                  {asset.prompt ||
                    asset.history?.topic ||
                    "No creative prompt saved."}
                </p>

                <div className={styles.assetDetails}>
                  <span>
                    {asset.platform || "No platform"}
                  </span>

                  <span>
                    {formatAssetDate(asset.createdAt)}
                  </span>
                </div>

                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open asset
                </a>
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}

function AssetStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <article className={styles.stat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatAssetDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
  }).format(new Date(value));
}
