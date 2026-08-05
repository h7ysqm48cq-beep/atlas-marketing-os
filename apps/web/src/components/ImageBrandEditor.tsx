"use client";

import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
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

type Brand = {
  id: string;
  name: string;
  primaryLogoAssetId: string | null;
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

type NormalizedPosition = {
  x: number;
  y: number;
};

export function ImageBrandEditor() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [logoAsset, setLogoAsset] = useState<Asset | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [placement, setPlacement] = useState<LogoPlacement>("AUTO");
  const [customPosition, setCustomPosition] =
    useState<NormalizedPosition | null>(null);
  const [draggingLogo, setDraggingLogo] = useState(false);
  const [scale, setScale] = useState(0.85);
  const [opacity, setOpacity] = useState(0.9);
  const [platform, setPlatform] = useState("Facebook");
  const [name, setName] = useState("");
  const [result, setResult] = useState<Asset | null>(null);
  const [showLogo, setShowLogo] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading images...");

  useEffect(() => {
    async function load() {
      try {
        const [assetResponse, brandResponse] = await Promise.all([
          fetch(`${API_URL}/assets?type=IMAGE`, { cache: "no-store" }),
          fetch(`${API_URL}/brands`, { cache: "no-store" }),
        ]);

        const assetData = (await assetResponse.json()) as Asset[];
        const brandData = (await brandResponse.json()) as Brand[];

        if (!assetResponse.ok || !Array.isArray(assetData)) {
          throw new Error("Unable to load Asset Library images.");
        }

        setAssets(assetData);
        setSelectedId(assetData[0]?.id ?? "");

        const activeBrand = Array.isArray(brandData) ? brandData[0] : null;
        const primaryLogoId = activeBrand?.primaryLogoAssetId;
        const logo = primaryLogoId
          ? assetData.find((asset) => asset.id === primaryLogoId) ?? null
          : null;

        if (logo) {
          setLogoAsset(logo);
          setMessage(
            "Live preview is ready. Drag the logo or use a preset position.",
          );
        } else {
          setMessage(
            assetData.length
              ? "Images loaded, but no primary brand logo is configured."
              : "No images are available in Asset Library yet.",
          );
        }
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Unable to load images.",
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (asset.id === logoAsset?.id) return false;
      return !query ? true : asset.name.toLowerCase().includes(query);
    });
  }, [assets, logoAsset, search]);

  const selected = assets.find((asset) => asset.id === selectedId) ?? null;

  const resolvedPlacement = useMemo<Exclude<LogoPlacement, "AUTO">>(() => {
    if (placement !== "AUTO") return placement;

    const width = selected?.width ?? 1;
    const height = selected?.height ?? 1;
    const portrait = height > width * 1.08;
    const landscape = width > height * 1.08;

    if (platform === "Instagram Story" || platform === "WhatsApp Status") {
      return "BOTTOM_CENTER";
    }

    if (platform === "Telegram") {
      return landscape ? "BOTTOM_RIGHT" : "BOTTOM_CENTER";
    }

    if (platform === "Facebook") {
      return portrait ? "BOTTOM_CENTER" : "BOTTOM_RIGHT";
    }

    return portrait ? "BOTTOM_LEFT" : "BOTTOM_RIGHT";
  }, [placement, platform, selected]);

  const logoStyle = useMemo<CSSProperties>(() => {
    const isStory =
      platform === "Instagram Story" || platform === "WhatsApp Status";
    const baseWidth =
      platform === "Facebook" ? 8.5 : platform === "Telegram" ? 8 : 8;
    const widthPercent = Math.max(5.5, Math.min(15, baseWidth * scale));
    const side =
      isStory ? "5.5%" : platform === "Telegram" ? "2.8%" : "3.5%";
    const bottom =
      isStory ? "7.5%" : platform === "Telegram" ? "3%" : "3.5%";

    const style: CSSProperties = {
      width: `${widthPercent}%`,
      opacity,
    };

    if (customPosition) {
      style.left = `${customPosition.x * 100}%`;
      style.top = `${customPosition.y * 100}%`;
      style.transform = "translate(-50%, -50%)";
      return style;
    }

    if (resolvedPlacement.includes("LEFT")) style.left = side;
    if (resolvedPlacement.includes("RIGHT")) style.right = side;
    if (resolvedPlacement.includes("TOP")) style.top = side;
    if (resolvedPlacement.includes("BOTTOM")) style.bottom = bottom;

    if (
      resolvedPlacement === "TOP_CENTER" ||
      resolvedPlacement === "BOTTOM_CENTER"
    ) {
      style.left = "50%";
      style.transform = "translateX(-50%)";
    }

    if (
      resolvedPlacement === "CENTER_LEFT" ||
      resolvedPlacement === "CENTER_RIGHT"
    ) {
      style.top = "50%";
      style.transform = "translateY(-50%)";
    }

    if (resolvedPlacement === "CENTER") {
      style.left = "50%";
      style.top = "50%";
      style.transform = "translate(-50%, -50%)";
    }

    return style;
  }, [customPosition, opacity, platform, resolvedPlacement, scale]);

  function updateCustomPosition(
    event: ReactPointerEvent<HTMLImageElement>,
  ) {
    const canvas = event.currentTarget.parentElement;
    if (!canvas) return;

    const bounds = canvas.getBoundingClientRect();
    const x = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.min(
      1,
      Math.max(0, (event.clientY - bounds.top) / bounds.height),
    );

    setCustomPosition({ x, y });
  }

  function startLogoDrag(event: ReactPointerEvent<HTMLImageElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingLogo(true);
    updateCustomPosition(event);
  }

  function moveLogo(event: ReactPointerEvent<HTMLImageElement>) {
    if (!draggingLogo) return;
    updateCustomPosition(event);
  }

  function endLogoDrag(event: ReactPointerEvent<HTMLImageElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingLogo(false);
  }

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
          logoX: customPosition?.x,
          logoY: customPosition?.y,
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
      setCustomPosition(null);
      setMessage("New branded image saved to Asset Library.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to apply logo.",
      );
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
            Drag the official logo anywhere on the image, then save a new version
            without changing the original.
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
                  setCustomPosition(null);
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
          <div className={styles.previewPanel}>
            <div className={styles.previewToolbar}>
              <div>
                <strong>Live preview</strong>
                <span>
                  {customPosition
                    ? "Custom position"
                    : placement === "AUTO"
                      ? `Auto: ${resolvedPlacement.replaceAll("_", " ").toLowerCase()}`
                      : resolvedPlacement.replaceAll("_", " ").toLowerCase()}
                </span>
              </div>

              <div>
                <button
                  type="button"
                  className={showLogo ? styles.activeToggle : ""}
                  onClick={() => setShowLogo((current) => !current)}
                >
                  {showLogo ? "Logo on" : "Original"}
                </button>
                <button
                  type="button"
                  className={showSafeArea ? styles.activeToggle : ""}
                  onClick={() => setShowSafeArea((current) => !current)}
                >
                  Safe area
                </button>
              </div>
            </div>

            <div className={styles.preview}>
              {selected ? (
                <div className={styles.canvas}>
                  <img
                    className={styles.sourceImage}
                    src={selected.url}
                    alt={selected.name}
                  />

                  {showSafeArea ? (
                    <div
                      className={`${styles.safeArea} ${
                        platform === "Instagram Story" ||
                        platform === "WhatsApp Status"
                          ? styles.storySafeArea
                          : ""
                      }`}
                    />
                  ) : null}

                  {showLogo && logoAsset ? (
                    <img
                      className={`${styles.logoPreview} ${
                        draggingLogo ? styles.logoDragging : ""
                      }`}
                      src={logoAsset.url}
                      alt="Official brand logo preview"
                      style={logoStyle}
                      draggable={false}
                      onPointerDown={startLogoDrag}
                      onPointerMove={moveLogo}
                      onPointerUp={endLogoDrag}
                      onPointerCancel={endLogoDrag}
                    />
                  ) : null}
                </div>
              ) : (
                <div>Select an image from Asset Library.</div>
              )}
            </div>

            <p className={styles.previewNote}>
              Drag the logo directly on the image. The backend saves the same
              position against the original full-resolution image.
            </p>
          </div>

          <div className={styles.controls}>
            <label>
              <span>New version name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={
                  selected ? `${selected.name} · Branded` : "Branded image"
                }
              />
            </label>

            <label>
              <span>Platform</span>
              <select
                value={platform}
                onChange={(event) => {
                  setPlatform(event.target.value);
                  setCustomPosition(null);
                }}
              >
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
                onChange={(event) => {
                  setPlacement(event.target.value as LogoPlacement);
                  setCustomPosition(null);
                }}
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

            {customPosition ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setCustomPosition(null)}
              >
                Reset to preset position
              </button>
            ) : null}

            <label>
              <span>Logo size · {Math.round(scale * 100)}%</span>
              <input
                type="range"
                min="0.6"
                max="1.5"
                step="0.05"
                value={scale}
                onChange={(event) => setScale(Number(event.target.value))}
              />
            </label>

            <label>
              <span>Logo opacity · {Math.round(opacity * 100)}%</span>
              <input
                type="range"
                min="0.25"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
              />
            </label>

            <button
              type="button"
              onClick={() => void applyLogo()}
              disabled={!selected || !logoAsset || saving}
            >
              {saving
                ? "Applying logo..."
                : "Apply logo and save new version"}
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
