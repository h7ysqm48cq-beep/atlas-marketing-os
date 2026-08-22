"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { RuntimeImage } from "./RuntimeImage";
import styles from "./AssetLibrary.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";
import { saveRemoteFile } from "@/lib/save-file";
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
  collection: string | null;
  url: string;
  thumbnailUrl: string | null;
  storageProvider: string | null;
  storagePath: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  remark: string | null;
  aiEnabled: boolean;
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

function isMissingLegacyAsset(asset: Asset) {
  if (asset.type !== "IMAGE") {
    return false;
  }

  if (asset.storageProvider === "railway-local") {
    return true;
  }

  if (asset.storageProvider) {
    return false;
  }

  return (
    /^https?:\/\/localhost(?::\d+)?\/storage\/assets\//i.test(asset.url) ||
    /api-production-7f7d\.up\.railway\.app\/storage\/assets\//i.test(asset.url)
  );
}

export function AssetLibrary() {
  const { t } = usePreferences();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetType | "ALL">("ALL");
  const [campaignFilter, setCampaignFilter] = useState("ALL");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [form, setForm] = useState<AssetForm>(emptyForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [editingRemark, setEditingRemark] = useState("");
  const [editingAiEnabled, setEditingAiEnabled] = useState(false);
  const [isUpdatingAiNotes, setIsUpdatingAiNotes] = useState(false);
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

      const matchesType = typeFilter === "ALL" || asset.type === typeFilter;

      const matchesCampaign =
        campaignFilter === "ALL" || asset.campaign?.id === campaignFilter;

      const matchesFavorite = !favoritesOnly || asset.isFavorite;

      return matchesSearch && matchesType && matchesCampaign && matchesFavorite;
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
        fetch(`${API_URL}/assets?view=library`, { cache: "no-store" }),
        fetch(`${API_URL}/campaigns`, { cache: "no-store" }),
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

  function updateForm<K extends keyof AssetForm>(key: K, value: AssetForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function uploadAssets(
    files: File[],
  ) {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    const validFiles =
      files.filter(
        (file) =>
          allowedTypes.includes(
            file.type,
          ) &&
          file.size <=
            10 *
              1024 *
              1024,
      );

    if (!validFiles.length) {
      setMessage(
        "Choose JPG, PNG or WEBP images up to 10MB each.",
      );
      return;
    }

    setIsUploading(true);

    setMessage(
      validFiles.length === 1
        ? `Uploading ${validFiles[0].name}...`
        : `Uploading ${validFiles.length} photos...`,
    );

    const uploaded:
      Asset[] = [];

    try {
      for (
        const file
        of validFiles
      ) {
        const formData =
          new FormData();

        formData.append(
          "file",
          file,
        );

        formData.append(
          "name",
          file.name,
        );

        formData.append(
          "collection",
          "Uploads",
        );

        const response =
          await fetch(
            `${API_URL}/assets/upload`,
            {
              method: "POST",
              body: formData,
            },
          );

        const data =
          (await response.json()) as
            | Asset
            | {
                message?:
                  | string
                  | string[];
              };

        if (
          !response.ok ||
          !("id" in data)
        ) {
          const responseMessage =
            "message" in data
              ? Array.isArray(
                  data.message,
                )
                ? data.message.join(
                    " ",
                  )
                : typeof data.message ===
                    "string"
                  ? data.message
                  : undefined
              : undefined;

          throw new Error(
            responseMessage ??
              `Unable to upload ${file.name}.`,
          );
        }

        uploaded.push(data);
      }

      setAssets(
        (current) => [
          ...uploaded,
          ...current.filter(
            (asset) =>
              !uploaded.some(
                (item) =>
                  item.id ===
                  asset.id,
              ),
          ),
        ],
      );

      setMessage(
        uploaded.length === 1
          ? `${uploaded[0].name} uploaded successfully.`
          : `${uploaded.length} photos uploaded successfully.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to upload photos.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function createAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage("Saving asset...");

    try {
      const response = await fetch(`${API_URL}/assets`, {
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
    const response = await fetch(`${API_URL}/assets/${asset.id}`, {
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
        item.id === asset.id ? { ...item, isFavorite: !item.isFavorite } : item,
      ),
    );
  }

  function openAiNotes(asset: Asset) {
    setEditingAsset(asset);
    setEditingRemark(asset.remark || "");
    setEditingAiEnabled(asset.aiEnabled);
  }

  function closeAiNotes() {
    if (isUpdatingAiNotes) return;

    setEditingAsset(null);
    setEditingRemark("");
    setEditingAiEnabled(false);
  }

  async function saveAiNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingAsset) return;

    setIsUpdatingAiNotes(true);
    setMessage(`Saving AI notes for ${editingAsset.name}...`);

    try {
      const response = await fetch(`${API_URL}/assets/${editingAsset.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          remark: editingRemark.trim() || null,
          aiEnabled: editingAiEnabled,
        }),
      });

      const data = (await response.json()) as
        | Asset
        | {
            message?: string | string[];
          };

      if (!response.ok || !("id" in data)) {
        const responseMessage =
          "message" in data
            ? Array.isArray(data.message)
              ? data.message.join(" ")
              : typeof data.message === "string"
                ? data.message
                : undefined
            : undefined;

        throw new Error(responseMessage ?? "Unable to save AI notes.");
      }

      setAssets((current) =>
        current.map((asset) => (asset.id === data.id ? data : asset)),
      );

      setEditingAsset(null);
      setEditingRemark("");
      setEditingAiEnabled(false);
      setMessage("AI notes saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save AI notes.",
      );
    } finally {
      setIsUpdatingAiNotes(false);
    }
  }

  async function deleteAsset(asset: Asset) {
    const confirmed = window.confirm(
      `Delete "${asset.name}" from Asset Library?`,
    );

    if (!confirmed) return;

    const response = await fetch(`${API_URL}/assets/${asset.id}`, {
      method: "DELETE",
    });

    if (!response.ok) return;

    setAssets((current) => current.filter((item) => item.id !== asset.id));
    setMessage("Asset deleted.");
  }

  function buildEditorHref(asset: Asset) {
    const params = new URLSearchParams({
      assetId: asset.id,
      source: "asset-library",
    });

    return `/image-editor?${params.toString()}`;
  }

  function openInEditor(asset: Asset) {
    if (isMissingLegacyAsset(asset)) {
      setMessage(
        `"${asset.name}" is a legacy image whose original file is no longer available.`,
      );
      return;
    }

    window.location.assign(buildEditorHref(asset));
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Asset Library</p>
          <h1>{t("assetLibraryTitle")}</h1>
          <p>
            Organise campaign visuals, generated images, source prompts and
            publishing formats without losing their campaign context.
          </p>
        </div>

        <div className={styles.heroActions}>
          <input
            id="asset-upload-input"
            className={styles.fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={isUploading}
            onChange={(event) => {
              const files = Array.from(
                event.target.files ?? [],
              );

              if (files.length) {
                void uploadAssets(files);
              }

              event.target.value = "";
            }}
          />

          <button
            className={styles.uploadButton}
            type="button"
            disabled={isUploading}
            onClick={() =>
              document.getElementById("asset-upload-input")?.click()
            }
          >
            {isUploading
              ? "Uploading..."
              : "📱 Phone / Device Photos"}
          </button>

          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => setIsModalOpen(true)}
          >
            + {t("addAsset")}
          </button>
        </div>
      </section>

      <section className={styles.stats}>
        <Stat label={t("totalAssets")} value={stats.total} />
        <Stat label={t("images")} value={stats.images} />
        <Stat label={t("campaigns")} value={stats.campaigns} />
        <Stat label={t("favorites")} value={stats.favorites} />
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
          <option value="ALL">{t("allTypes")}</option>
          <option value="IMAGE">{t("images")}</option>
          <option value="VIDEO">Videos</option>
          <option value="DOCUMENT">Documents</option>
          <option value="TEMPLATE">Templates</option>
        </select>

        <select
          value={campaignFilter}
          onChange={(event) => setCampaignFilter(event.target.value)}
        >
          <option value="ALL">{t("allCampaigns")}</option>
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
          ★ {t("favorites")}
        </button>

        <button onClick={() => void load()}>{t("refresh")}</button>
      </section>

      <p className={styles.message}>{message}</p>

      {filteredAssets.length === 0 ? (
        <section className={styles.emptyState}>
          <span>◇</span>
          <strong>No matching assets</strong>
          <p>Add your first asset or adjust the current filters.</p>
          <button onClick={() => setIsModalOpen(true)}>Add asset</button>
        </section>
      ) : (
        <section className={styles.grid}>
          {filteredAssets.map((asset) => (
            <article className={styles.card} key={asset.id}>
              <div
                className={styles.preview}
                role="link"
                tabIndex={0}
                aria-label={`Edit ${asset.name}`}
                onClick={() => openInEditor(asset)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openInEditor(asset);
                  }
                }}
              >
                {asset.type === "IMAGE" ? (
                  isMissingLegacyAsset(asset) ? (
                    <div className={styles.missingPreview}>
                      <span>Image unavailable</span>
                      <small>Legacy file is no longer available</small>
                    </div>
                  ) : (
                    <RuntimeImage
                      width={asset.width || undefined}
                      height={asset.height || undefined}
                      src={asset.thumbnailUrl || asset.url}
                      alt={asset.name}
                      loading="lazy"
                      sizes="(max-width: 760px) 50vw, (max-width: 1200px) 33vw, 280px"
                    />
                  )
                ) : (
                  <div className={styles.filePreview}>
                    <span>{asset.type}</span>
                  </div>
                )}

                <button
                  className={asset.isFavorite ? styles.favoriteActive : ""}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleFavorite(asset);
                  }}
                  aria-label="Toggle favorite"
                >
                  ★
                </button>
              </div>

              <div className={styles.cardBody}>
                <div
                  className={styles.studioContent}
                  role="link"
                  tabIndex={0}
                  aria-label={`Edit ${asset.name}`}
                  onClick={() => openInEditor(asset)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openInEditor(asset);
                    }
                  }}
                >
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
                    <span
                      className={
                        asset.aiEnabled
                          ? styles.aiReadyBadge
                          : styles.aiDisabledBadge
                      }
                    >
                      {asset.aiEnabled ? "AI Ready" : "AI Disabled"}
                    </span>
                  </div>

                  <div className={styles.aiNotePreview}>
                    <strong>AI Remark</strong>
                    <p>
                      {asset.remark || "No AI usage instruction saved yet."}
                    </p>
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  <small>{formatDate(asset.createdAt)}</small>
                  <div>
                    <a href={asset.url} target="_blank" rel="noreferrer">
                      View
                    </a>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const extension =
                            asset.mimeType === "image/png"
                              ? "png"
                              : asset.mimeType === "image/jpeg"
                                ? "jpg"
                                : asset.mimeType === "video/mp4"
                                  ? "mp4"
                                  : "file";

                          const result = await saveRemoteFile({
                            url: asset.url,
                            filename: `${asset.name || "atlas-asset"}.${extension}`,
                            mimeType: asset.mimeType,
                            title: asset.name,
                          });
                          setMessage(
                            result === "shared"
                              ? "Choose Save Image or Save to Files."
                              : "Asset downloaded.",
                          );
                        } catch (error) {
                          if (error instanceof DOMException && error.name === "AbortError") return;
                          setMessage("Unable to save asset.");
                        }
                      }}
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => openAiNotes(asset)}>
                      Edit AI Notes
                    </button>

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

      {editingAsset ? (
        <div className={styles.modalBackdrop} onMouseDown={closeAiNotes}>
          <div
            className={styles.modal}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Asset intelligence</p>
                <h2>Edit AI notes</h2>
              </div>

              <button type="button" onClick={closeAiNotes} aria-label="Close">
                ×
              </button>
            </div>

            <div className={styles.assetEditorSummary}>
              {editingAsset.type === "IMAGE" ? (
                <RuntimeImage
                  width={editingAsset.width || undefined}
                  height={editingAsset.height || undefined}
                  src={editingAsset.thumbnailUrl || editingAsset.url}
                  alt={editingAsset.name}
                />
              ) : (
                <div className={styles.filePreview}>{editingAsset.type}</div>
              )}

              <div>
                <strong>{editingAsset.name}</strong>
                <span>{editingAsset.collection || "No collection"}</span>
              </div>
            </div>

            <form onSubmit={saveAiNotes}>
              <label className={styles.field}>
                <span>Comment / Remark for AI</span>
                <textarea
                  value={editingRemark}
                  onChange={(event) => setEditingRemark(event.target.value)}
                  placeholder="Explain what this asset is, when AI should use it, placement rules, visual restrictions and anything AI must avoid."
                />
              </label>

              <label className={styles.aiToggle}>
                <input
                  type="checkbox"
                  checked={editingAiEnabled}
                  onChange={(event) =>
                    setEditingAiEnabled(event.target.checked)
                  }
                />

                <span>
                  <strong>Allow AI to use this asset</strong>
                  <small>
                    When enabled, the asset and its remark can be included in AI
                    context.
                  </small>
                </span>
              </label>

              <div className={styles.aiRemarkExample}>
                <strong>Example</strong>
                <p>
                  Official brand logo. Always place at the bottom centre. Keep
                  the original aspect ratio. Do not crop, recolour or enlarge
                  it.
                </p>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={closeAiNotes}
                  disabled={isUpdatingAiNotes}
                >
                  Cancel
                </button>

                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={isUpdatingAiNotes}
                >
                  {isUpdatingAiNotes ? "Saving..." : "Save AI notes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

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
              <button onClick={() => setIsModalOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <form onSubmit={createAsset}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Name</span>
                  <input
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>Type</span>
                  <select
                    value={form.type}
                    onChange={(event) =>
                      updateForm("type", event.target.value as AssetType)
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
                  onChange={(event) => updateForm("url", event.target.value)}
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
                  onChange={(event) => updateForm("prompt", event.target.value)}
                />
              </label>

              <div className={styles.modalActions}>
                <button type="button" onClick={() => setIsModalOpen(false)}>
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

function Stat({ label, value }: { label: string; value: number }) {
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
