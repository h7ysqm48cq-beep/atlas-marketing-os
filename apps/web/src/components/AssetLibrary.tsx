"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./AssetLibrary.module.css";

type AssetType = "IMAGE" | "VIDEO" | "DOCUMENT" | "TEMPLATE";

type Campaign = {
  id: string;
  name: string;
};

type Asset = {
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
  campaign: Campaign | null;
  history: {
    id: string;
    topic: string;
  } | null;
};

type AssetForm = {
  name: string;
  type: AssetType;
  campaignId: string;
  provider: string;
  platform: string;
  prompt: string;
  url: string;
  thumbnailUrl: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const emptyForm: AssetForm = {
  name: "",
  type: "IMAGE",
  campaignId: "",
  provider: "Manual",
  platform: "Facebook",
  prompt: "",
  url: "",
  thumbnailUrl: "",
};

export function AssetLibrary() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetType | "ALL">("ALL");
  const [campaignFilter, setCampaignFilter] = useState("ALL");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [form, setForm] = useState<AssetForm>(emptyForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("Loading assets...");

  useEffect(() => {
    void load();
  }, []);

  const filteredAssets = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return assets.filter((asset) => {
      const matchesSearch =
        !cleanSearch ||
        asset.name.toLowerCase().includes(cleanSearch) ||
        asset.prompt?.toLowerCase().includes(cleanSearch) ||
        asset.provider?.toLowerCase().includes(cleanSearch);

      const matchesType =
        typeFilter === "ALL" || asset.type === typeFilter;

      const matchesCampaign =
        campaignFilter === "ALL" ||
        asset.campaign?.id === campaignFilter;

      const matchesFavorite = !favoritesOnly || asset.isFavorite;

      return (
        matchesSearch &&
        matchesType &&
        matchesCampaign &&
        matchesFavorite
      );
    });
  }, [assets, campaignFilter, favoritesOnly, search, typeFilter]);

  const stats = useMemo(
    () => ({
      total: assets.length,
      images: assets.filter((asset) => asset.type === "IMAGE").length,
      campaigns: new Set(
        assets
          .map((asset) => asset.campaign?.id)
          .filter((id): id is string => Boolean(id)),
      ).size,
      favorites: assets.filter((asset) => asset.isFavorite).length,
    }),
    [assets],
  );

  async function load() {
    try {
      const [assetResponse, campaignResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/assets`, { cache: "no-store" }),
        fetch(`${API_BASE_URL}/campaigns`, { cache: "no-store" }),
      ]);

      const assetData = (await assetResponse.json()) as Asset[];
      const campaignData = (await campaignResponse.json()) as Campaign[];

      if (!assetResponse.ok || !Array.isArray(assetData)) {
        throw new Error("Unable to load assets.");
      }

      if (!campaignResponse.ok || !Array.isArray(campaignData)) {
        throw new Error("Unable to load campaigns.");
      }

      setAssets(assetData);
      setCampaigns(campaignData);
      setMessage(
        assetData.length === 0
          ? "No assets saved yet."
          : `${assetData.length} asset${assetData.length === 1 ? "" : "s"} loaded.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load assets.",
      );
    }
  }

  function updateForm<K extends keyof AssetForm>(
    key: K,
    value: AssetForm[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function createAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage("Saving asset...");

    try {
      const response = await fetch(`${API_BASE_URL}/assets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          campaignId: form.campaignId || undefined,
          provider: form.provider.trim() || undefined,
          platform: form.platform.trim() || undefined,
          prompt: form.prompt.trim() || undefined,
          url: form.url.trim(),
          thumbnailUrl: form.thumbnailUrl.trim() || undefined,
        }),
      });

      const data = (await response.json()) as Asset | { message?: string };

      if (!response.ok || !("id" in data)) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to save asset.",
        );
      }

      await load();
      setForm(emptyForm);
      setIsModalOpen(false);
      setMessage("Asset saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save asset.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleFavorite(asset: Asset) {
    const response = await fetch(`${API_BASE_URL}/assets/${asset.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isFavorite: !asset.isFavorite,
      }),
    });

    if (!response.ok) return;

    setAssets((current) =>
      current.map((item) =>
        item.id === asset.id
          ? { ...item, isFavorite: !item.isFavorite }
          : item,
      ),
    );
  }

  async function deleteAsset(asset: Asset) {
    const confirmed = window.confirm(
      `Delete "${asset.name}" from Asset Library?`,
    );

    if (!confirmed) return;

    const response = await fetch(`${API_BASE_URL}/assets/${asset.id}`, {
      method: "DELETE",
    });

    if (!response.ok) return;

    setAssets((current) =>
      current.filter((item) => item.id !== asset.id),
    );
    setMessage("Asset deleted.");
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Asset Library</p>
          <h1>Every image, video and creative asset in one workspace.</h1>
          <p>
            Organise campaign visuals, generated images, source prompts and
            publishing formats without losing their campaign context.
          </p>
        </div>

        <button
          className={styles.primaryButton}
          onClick={() => setIsModalOpen(true)}
        >
          + Add asset
        </button>
      </section>

      <section className={styles.stats}>
        <Stat label="Total assets" value={stats.total} />
        <Stat label="Images" value={stats.images} />
        <Stat label="Campaigns" value={stats.campaigns} />
        <Stat label="Favorites" value={stats.favorites} />
      </section>

      <section className={styles.toolbar}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search asset name, prompt or provider..."
        />

        <select
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value as AssetType | "ALL")
          }
        >
          <option value="ALL">All types</option>
          <option value="IMAGE">Images</option>
          <option value="VIDEO">Videos</option>
          <option value="DOCUMENT">Documents</option>
          <option value="TEMPLATE">Templates</option>
        </select>

        <select
          value={campaignFilter}
          onChange={(event) => setCampaignFilter(event.target.value)}
        >
          <option value="ALL">All campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>

        <button
          className={favoritesOnly ? styles.activeFilter : ""}
          onClick={() => setFavoritesOnly((current) => !current)}
        >
          ★ Favorites
        </button>

        <button onClick={() => void load()}>Refresh</button>
      </section>

      <p className={styles.message}>{message}</p>

      {filteredAssets.length === 0 ? (
        <section className={styles.emptyState}>
          <span>◇</span>
          <strong>No matching assets</strong>
          <p>
            Add your first asset or adjust the current filters.
          </p>
          <button onClick={() => setIsModalOpen(true)}>
            Add asset
          </button>
        </section>
      ) : (
        <section className={styles.grid}>
          {filteredAssets.map((asset) => (
            <article className={styles.card} key={asset.id}>
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

                <button
                  className={asset.isFavorite ? styles.favoriteActive : ""}
                  onClick={() => void toggleFavorite(asset)}
                  aria-label="Toggle favorite"
                >
                  ★
                </button>
              </div>

              <div className={styles.cardBody}>
                <div className={styles.cardTop}>
                  <span>{asset.type}</span>
                  <small>{asset.provider || "Unknown provider"}</small>
                </div>

                <h2>{asset.name}</h2>
                <p>
                  {asset.prompt || "No source prompt saved for this asset."}
                </p>

                <div className={styles.meta}>
                  <span>{asset.campaign?.name || "No campaign"}</span>
                  <span>{asset.platform || "No platform"}</span>
                </div>

                <div className={styles.cardFooter}>
                  <small>{formatDate(asset.createdAt)}</small>
                  <div>
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
                    <button
                      className={styles.deleteButton}
                      onClick={() => void deleteAsset(asset)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {isModalOpen ? (
        <div
          className={styles.modalBackdrop}
          onMouseDown={() => !isSaving && setIsModalOpen(false)}
        >
          <div
            className={styles.modal}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>New asset</p>
                <h2>Add creative asset</h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={createAsset}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Name</span>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      updateForm("name", event.target.value)
                    }
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>Type</span>
                  <select
                    value={form.type}
                    onChange={(event) =>
                      updateForm(
                        "type",
                        event.target.value as AssetType,
                      )
                    }
                  >
                    <option value="IMAGE">Image</option>
                    <option value="VIDEO">Video</option>
                    <option value="DOCUMENT">Document</option>
                    <option value="TEMPLATE">Template</option>
                  </select>
                </label>

                <label className={styles.field}>
                  <span>Campaign</span>
                  <select
                    value={form.campaignId}
                    onChange={(event) =>
                      updateForm("campaignId", event.target.value)
                    }
                  >
                    <option value="">No campaign</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>Provider</span>
                  <input
                    value={form.provider}
                    onChange={(event) =>
                      updateForm("provider", event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Platform</span>
                  <input
                    value={form.platform}
                    onChange={(event) =>
                      updateForm("platform", event.target.value)
                    }
                  />
                </label>
              </div>

              <label className={styles.field}>
                <span>Asset URL</span>
                <input
                  type="url"
                  value={form.url}
                  onChange={(event) =>
                    updateForm("url", event.target.value)
                  }
                  placeholder="https://..."
                  required
                />
              </label>

              <label className={styles.field}>
                <span>Thumbnail URL</span>
                <input
                  type="url"
                  value={form.thumbnailUrl}
                  onChange={(event) =>
                    updateForm("thumbnailUrl", event.target.value)
                  }
                  placeholder="Optional"
                />
              </label>

              <label className={styles.field}>
                <span>Prompt or source notes</span>
                <textarea
                  value={form.prompt}
                  onChange={(event) =>
                    updateForm("prompt", event.target.value)
                  }
                />
              </label>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save asset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
  }).format(new Date(value));
}
