"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/api";
import styles from "./ImageBrandEditor.module.css";

type Asset = {
  id: string;
  name: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  platform: string | null;
  width: number | null;
  height: number | null;
};

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

export function ImageBrandEditor() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [placement, setPlacement] = useState<LogoPlacement>("AUTO");
  const [scale, setScale] = useState(0.85);
  const [opacity, setOpacity] = useState(0.9);
  const [platform, setPlatform] = useState("Facebook");
  const [name, setName] = useState("");
  const [result, setResult] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading images...");

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`${API_URL}/assets?type=IMAGE`, {
          cache: "no-store",
        });
        const data = (await response.json()) as Asset[];

        if (!response.ok || !Array.isArray(data)) {
          throw new Error("Unable to load Asset Library images.");
        }

        setAssets(data);
        setSelectedId(data[0]?.id ?? "");
        setMessage(
          data.length
            ? "Choose an image, adjust the logo and save a new version."
            : "No images are available in Asset Library yet.",
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to load images.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets.filter((asset) =>
      !query ? true : asset.name.toLowerCase().includes(query),
    );
  }, [assets, search]);

  const selected = assets.find((asset) => asset.id === selectedId) ?? null;

  async function applyLogo() {
    if (!selected) return;

    setSaving(true);
    setMessage("Applying the official brand logo...");

    try {
      const response = await fetch(`${API_URL}/asset-images/brand-existing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: selected.id,
          name: name.trim() || `${selected.name} · Branded`,
          platform,
          logoPlacement: placement,
          logoScale: scale,
          logoOpacity: opacity,
        }),
      });

      const data = (await response.json()) as Asset & {
        message?: string | string[];
      };

      if (!response.ok || !data.id) {
        const responseMessage = Array.isArray(data.message)
          ? data.message.join(" ")
          : data.message;
        throw new Error(responseMessage || "Unable to apply logo.");
      }

      setResult(data);
      setAssets((current) => [data, ...current]);
      setSelectedId(data.id);
      setName("");
      setMessage("New branded image saved to Asset Library.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to apply logo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p>Image tools</p>
          <h1>Image Editor & Logo</h1>
          <span>
            Select an existing image, add the official brand logo and save a new
            version without changing the original.
          </span>
        </div>

        <a href="/assets">Open Asset Library</a>
      </section>

      <p className={styles.message}>{message}</p>

      <section className={styles.workspace}>
        <aside className={styles.library}>
          <div className={styles.libraryHeader}>
            <strong>Choose image</strong>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search images..."
            />
          </div>

          <div className={styles.assetGrid}>
            {filteredAssets.map((asset) => (
              <button
                type="button"
                key={asset.id}
                className={selectedId === asset.id ? styles.selectedAsset : ""}
                onClick={() => {
                  setSelectedId(asset.id);
                  setResult(null);
                  setName("");
                }}
              >
                <img src={asset.thumbnailUrl || asset.url} alt={asset.name} />
                <span>{asset.name}</span>
              </button>
            ))}

            {!loading && !filteredAssets.length ? (
              <p>No matching images.</p>
            ) : null}
          </div>
        </aside>

        <main className={styles.editor}>
          <div className={styles.preview}>
            {selected ? (
              <img src={selected.url} alt={selected.name} />
            ) : (
              <div>Select an image from Asset Library.</div>
            )}
          </div>

          <div className={styles.controls}>
            <label>
              <span>New version name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={selected ? `${selected.name} · Branded` : "Branded image"}
              />
            </label>

            <label>
              <span>Platform</span>
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                <option value="Facebook">Facebook</option>
                <option value="Telegram">Telegram</option>
                <option value="Instagram Story">Instagram Story</option>
                <option value="WhatsApp Status">WhatsApp Status</option>
                <option value="Multi-platform">Multi-platform</option>
              </select>
            </label>

            <label>
              <span>Logo position</span>
              <select
                value={placement}
                onChange={(event) => setPlacement(event.target.value as LogoPlacement)}
              >
                <option value="AUTO">Auto · Recommended</option>
                <option value="BOTTOM_LEFT">Bottom left</option>
                <option value="BOTTOM_CENTER">Bottom centre</option>
                <option value="BOTTOM_RIGHT">Bottom right</option>
                <option value="TOP_LEFT">Top left</option>
                <option value="TOP_CENTER">Top centre</option>
                <option value="TOP_RIGHT">Top right</option>
                <option value="CENTER_LEFT">Centre left</option>
                <option value="CENTER">Centre</option>
                <option value="CENTER_RIGHT">Centre right</option>
              </select>
            </label>

            <label>
              <span>Logo size</span>
              <select value={scale} onChange={(event) => setScale(Number(event.target.value))}>
                <option value={0.7}>Small</option>
                <option value={0.85}>Compact · Recommended</option>
                <option value={1}>Standard</option>
                <option value={1.2}>Large</option>
                <option value={1.4}>Extra large</option>
              </select>
            </label>

            <label>
              <span>Logo opacity</span>
              <select
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
              >
                <option value={1}>100%</option>
                <option value={0.9}>90% · Recommended</option>
                <option value={0.75}>75%</option>
                <option value={0.6}>60%</option>
                <option value={0.4}>40% watermark</option>
              </select>
            </label>

            <button type="button" onClick={() => void applyLogo()} disabled={!selected || saving}>
              {saving ? "Applying logo..." : "Apply logo and save new version"}
            </button>
          </div>

          {result ? (
            <section className={styles.result}>
              <div>
                <strong>Saved successfully</strong>
                <span>{result.name}</span>
              </div>
              <a href={result.url} target="_blank" rel="noreferrer">
                View full image
              </a>
            </section>
          ) : null}
        </main>
      </section>
    </div>
  );
}
