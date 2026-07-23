"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./CampaignAssets.module.css";
import { AssetDetailsDrawer } from "./campaign-assets/AssetDetailsDrawer";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type AssetType =
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "TEMPLATE";

type AssetTypeFilter = AssetType | "ALL";

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
  const [selectedAsset, setSelectedAsset] =
    useState<CampaignAsset | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState(
    "Loading campaign assets...",
  );

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] =
    useState<AssetTypeFilter>("ALL");
  const [platformFilter, setPlatformFilter] =
    useState("ALL");
  const [favoritesOnly, setFavoritesOnly] =
    useState(false);

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
      favorites: assets.filter(
        (asset) => asset.isFavorite,
      ).length,
    }),
    [assets],
  );

  const platforms = useMemo(() => {
    return Array.from(
      new Set(
        assets
          .map((asset) => asset.platform?.trim())
          .filter(
            (platform): platform is string =>
              Boolean(platform),
          ),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return assets.filter((asset) => {
      const searchableText = [
        asset.name,
        asset.prompt,
        asset.provider,
        asset.platform,
        asset.history?.topic,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !cleanSearch ||
        searchableText.includes(cleanSearch);

      const matchesType =
        typeFilter === "ALL" ||
        asset.type === typeFilter;

      const matchesPlatform =
        platformFilter === "ALL" ||
        asset.platform === platformFilter;

      const matchesFavorite =
        !favoritesOnly || asset.isFavorite;

      return (
        matchesSearch &&
        matchesType &&
        matchesPlatform &&
        matchesFavorite
      );
    });
  }, [
    assets,
    favoritesOnly,
    platformFilter,
    search,
    typeFilter,
  ]);

  const hasActiveFilters =
    Boolean(search.trim()) ||
    typeFilter !== "ALL" ||
    platformFilter !== "ALL" ||
    favoritesOnly;

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

  function clearFilters() {
    setSearch("");
    setTypeFilter("ALL");
    setPlatformFilter("ALL");
    setFavoritesOnly(false);
  }

  async function copyPrompt(asset: CampaignAsset) {
    if (!asset.prompt) {
      setMessage(`"${asset.name}" has no saved prompt.`);
      return;
    }

    try {
      await navigator.clipboard.writeText(asset.prompt);
      setMessage(`Prompt copied from "${asset.name}".`);
    } catch {
      setMessage("Unable to copy prompt.");
    }
  }

  async function deleteAsset(asset: CampaignAsset) {
    const confirmed = window.confirm(
      `Delete "${asset.name}" from this campaign?`,
    );

    if (!confirmed) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/assets/${asset.id}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error("Unable to delete asset.");
      }

      setAssets((current) =>
        current.filter((item) => item.id !== asset.id),
      );

      setMessage(`"${asset.name}" deleted.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to delete asset.",
      );
    }
  }

  function buildStudioHref(asset: CampaignAsset) {
    const params = new URLSearchParams({
      topic: asset.history?.topic || asset.name,
      campaignId,
      campaignName,
    });

    if (asset.history) {
      params.set("historyId", asset.history.id);
    }

    if (asset.prompt) {
      params.set("imagePrompt", asset.prompt);
    }

    if (asset.platform) {
      params.set("platform", asset.platform);
    }

    return `/ai-studio?${params.toString()}`;
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
            Search and organise images, videos, documents and
            templates belonging specifically to this campaign.
          </p>
        </div>

        <div className={styles.campaignMeta}>
          <span>{campaignName}</span>

          <strong>
            {isLoading
              ? "Loading"
              : `${filteredAssets.length}/${assets.length} assets`}
          </strong>
        </div>
      </header>

      <section className={styles.stats}>
        <AssetStat
          label="Total assets"
          value={stats.total}
        />

        <AssetStat
          label="Images"
          value={stats.images}
        />

        <AssetStat
          label="Videos"
          value={stats.videos}
        />

        <AssetStat
          label="Favorites"
          value={stats.favorites}
        />
      </section>

      <section className={styles.filterPanel}>
        <div className={styles.searchField}>
          <span>Search assets</span>

          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search name, prompt, provider or topic..."
          />
        </div>

        <label className={styles.filterField}>
          <span>Type</span>

          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(
                event.target.value as AssetTypeFilter,
              )
            }
          >
            <option value="ALL">All types</option>
            <option value="IMAGE">Images</option>
            <option value="VIDEO">Videos</option>
            <option value="DOCUMENT">Documents</option>
            <option value="TEMPLATE">Templates</option>
          </select>
        </label>

        <label className={styles.filterField}>
          <span>Platform</span>

          <select
            value={platformFilter}
            onChange={(event) =>
              setPlatformFilter(event.target.value)
            }
          >
            <option value="ALL">All platforms</option>

            {platforms.map((platform) => (
              <option
                key={platform}
                value={platform}
              >
                {platform}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={
            favoritesOnly
              ? styles.activeFavoriteFilter
              : styles.favoriteFilter
          }
          onClick={() =>
            setFavoritesOnly((current) => !current)
          }
        >
          ★ Favorites
        </button>

        <button
          type="button"
          className={styles.clearButton}
          disabled={!hasActiveFilters}
          onClick={clearFilters}
        >
          Clear
        </button>
      </section>

      <section className={styles.toolbar}>
        <div>
          <span>Campaign library</span>

          <strong>
            {hasActiveFilters
              ? `${filteredAssets.length} matching asset${
                  filteredAssets.length === 1 ? "" : "s"
                }`
              : message}
          </strong>
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
            Atlas is retrieving the creative files connected to
            this campaign.
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
      ) : filteredAssets.length === 0 ? (
        <section className={styles.emptyState}>
          <span>⌕</span>

          <h3>No matching campaign assets</h3>

          <p>
            No assets match the current search and filter
            combination.
          </p>

          <button
            type="button"
            onClick={clearFilters}
          >
            Clear all filters
          </button>
        </section>
      ) : (
        <section className={styles.assetGrid}>
          {filteredAssets.map((asset) => (
            <article
              className={styles.assetCard}
              key={asset.id}
            >
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
                    {asset.provider ||
                      "Unknown provider"}
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

                <div className={styles.workflowActions}>
                  <button
                    type="button"
                    onClick={() => setSelectedAsset(asset)}
                  >
                    Details
                  </button>

                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>

                  <a href={asset.url} download>
                    Download
                  </a>

                  {asset.history ? (
                    <a
                      href={`/content-history?historyId=${encodeURIComponent(
                        asset.history.id,
                      )}`}
                    >
                      History
                    </a>
                  ) : null}

                  <a href={buildStudioHref(asset)}>
                    AI Studio
                  </a>

                  <button
                    type="button"
                    disabled={!asset.prompt}
                    onClick={() => void copyPrompt(asset)}
                  >
                    Copy prompt
                  </button>

                  <button
                    type="button"
                    className={styles.deleteAction}
                    onClick={() => void deleteAsset(asset)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {selectedAsset ? (
        <AssetDetailsDrawer
          asset={selectedAsset}
          studioHref={buildStudioHref(selectedAsset)}
          onClose={() => setSelectedAsset(null)}
          onCopyPrompt={() => void copyPrompt(selectedAsset)}
        />
      ) : null}
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
