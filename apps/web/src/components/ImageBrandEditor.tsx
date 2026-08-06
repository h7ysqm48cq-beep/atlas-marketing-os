"use client";

import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_URL } from "@/lib/api";
import styles from "./ImageBrandEditorV3.module.css";

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

type NormalizedPosition = { x: number; y: number };
type ToolPanel = "images" | "logo" | "layers" | "settings";

const gridPlacements: Array<{
  value: Exclude<LogoPlacement, "AUTO">;
  label: string;
  mark: string;
}> = [
  { value: "TOP_LEFT", label: "Top left", mark: "↖" },
  { value: "TOP_CENTER", label: "Top centre", mark: "↑" },
  { value: "TOP_RIGHT", label: "Top right", mark: "↗" },
  { value: "CENTER_LEFT", label: "Centre left", mark: "←" },
  { value: "CENTER", label: "Centre", mark: "•" },
  { value: "CENTER_RIGHT", label: "Centre right", mark: "→" },
  { value: "BOTTOM_LEFT", label: "Bottom left", mark: "↙" },
  { value: "BOTTOM_CENTER", label: "Bottom centre", mark: "↓" },
  { value: "BOTTOM_RIGHT", label: "Bottom right", mark: "↘" },
];

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
  const [activeTool, setActiveTool] = useState<ToolPanel>("logo");
  const [fullscreen, setFullscreen] = useState(false);
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
        setLogoAsset(logo);
        setMessage(
          logo
            ? "Ready. Drag the logo directly on the canvas."
            : assetData.length
              ? "Images loaded, but no primary brand logo is configured."
              : "No images are available in Asset Library yet.",
        );
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

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (asset.id === logoAsset?.id) return false;
      return !query || asset.name.toLowerCase().includes(query);
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
    const baseWidth = platform === "Facebook" ? 8.5 : 8;
    const widthPercent = Math.max(5.5, Math.min(15, baseWidth * scale));
    const side =
      isStory ? "5.5%" : platform === "Telegram" ? "2.8%" : "3.5%";
    const bottom =
      isStory ? "7.5%" : platform === "Telegram" ? "3%" : "3.5%";
    const style: CSSProperties = { width: `${widthPercent}%`, opacity };
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

  const positionLabel = customPosition
    ? "Custom position"
    : placement === "AUTO"
      ? `Auto: ${resolvedPlacement.replaceAll("_", " ").toLowerCase()}`
      : resolvedPlacement.replaceAll("_", " ").toLowerCase();

  function chooseAsset(asset: Asset) {
    setSelectedId(asset.id);
    setResult(null);
    setName("");
    setCustomPosition(null);
    setActiveTool("logo");
  }

  function choosePlacement(value: LogoPlacement) {
    setPlacement(value);
    setCustomPosition(null);
  }

  function updateCustomPosition(event: ReactPointerEvent<HTMLImageElement>) {
    const canvas = event.currentTarget.parentElement;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.min(
      0.96,
      Math.max(0.04, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.min(
      0.96,
      Math.max(0.04, (event.clientY - bounds.top) / bounds.height),
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
    if (draggingLogo) updateCustomPosition(event);
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

  function renderCanvas(fullscreenMode = false) {
    if (!selected) {
      return <div className={styles.emptyCanvas}>Choose an image to begin.</div>;
    }
    return (
      <div
        className={`${styles.canvas} ${
          fullscreenMode ? styles.fullscreenCanvas : ""
        }`}
      >
        <img
          className={styles.sourceImage}
          src={selected.url}
          alt={selected.name}
          draggable={false}
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
    );
  }

  function renderPositionPicker() {
    return (
      <div className={styles.positionSection}>
        <div className={styles.positionHeader}>
          <span>Logo position</span>
          {customPosition ? (
            <span className={styles.positionCustom}>Custom</span>
          ) : null}
        </div>
        <button
          type="button"
          className={`${styles.autoButton} ${
            placement === "AUTO" && !customPosition
              ? styles.autoButtonActive
              : ""
          }`}
          onClick={() => choosePlacement("AUTO")}
        >
          ✦ Auto · Recommended
        </button>
        <div className={styles.positionGrid}>
          {gridPlacements.map((option) => (
            <button
              type="button"
              key={option.value}
              title={option.label}
              aria-label={option.label}
              className={
                placement === option.value && !customPosition
                  ? styles.positionSelected
                  : ""
              }
              onClick={() => choosePlacement(option.value)}
            >
              {option.mark}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderLogoControls(compact = false) {
    return (
      <div className={compact ? styles.compactControls : styles.controls}>
        {!compact ? (
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
        ) : null}
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
        {renderPositionPicker()}
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
          <span>Opacity · {Math.round(opacity * 100)}%</span>
          <input
            type="range"
            min="0.25"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
        </label>
        <div className={styles.toggleRow}>
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
        {customPosition ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setCustomPosition(null)}
          >
            Reset position
          </button>
        ) : null}
      </div>
    );
  }

  const studioHref = selected
    ? `/ai-studio?assetId=${encodeURIComponent(selected.id)}&source=image-editor`
    : "/ai-studio";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Image Editor</h1>
          <span>{selected?.name || "Choose an image"}</span>
        </div>
        <div className={styles.headerActions}>
          <a href="/assets">Assets</a>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            disabled={!selected}
          >
            Fullscreen
          </button>
        </div>
      </header>

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
                onClick={() => chooseAsset(asset)}
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
          <nav className={styles.toolRail} aria-label="Editor tools">
            {([
              ["images", "▦", "Images"],
              ["logo", "◇", "Logo"],
              ["layers", "▤", "Layers"],
              ["settings", "⚙", "Output"],
            ] as Array<[ToolPanel, string, string]>).map(([tool, icon, label]) => (
              <button
                type="button"
                key={tool}
                className={activeTool === tool ? styles.activeTool : ""}
                onClick={() => setActiveTool(tool)}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </nav>

          <section className={styles.previewPanel}>
            <div className={styles.previewToolbar}>
              <div>
                <strong>Live preview</strong>
                <span>{positionLabel}</span>
              </div>
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                disabled={!selected}
              >
                Open fullscreen
              </button>
            </div>
            <button
              type="button"
              className={styles.preview}
              onClick={(event) => {
                if (event.target === event.currentTarget) setFullscreen(true);
              }}
              aria-label="Open fullscreen preview"
            >
              {renderCanvas()}
            </button>
          </section>

          <aside className={styles.inspector}>
            {activeTool === "images" ? (
              <div className={styles.mobileAssetPanel}>
                <strong>Images</strong>
                <div className={styles.mobileAssetGrid}>
                  {filteredAssets.slice(0, 12).map((asset) => (
                    <button
                      type="button"
                      key={asset.id}
                      className={
                        selectedId === asset.id ? styles.selectedAsset : ""
                      }
                      onClick={() => chooseAsset(asset)}
                    >
                      <img src={asset.thumbnailUrl || asset.url} alt={asset.name} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTool === "logo" ? renderLogoControls() : null}

            {activeTool === "layers" ? (
              <div className={styles.layersPanel}>
                <strong>Layers</strong>
                <button type="button" className={styles.layerRow}>
                  <span className={styles.layerThumbnail}>
                    {selected ? (
                      <img src={selected.thumbnailUrl || selected.url} alt="" />
                    ) : null}
                  </span>
                  <span>
                    <b>Image</b>
                    <small>Background · Locked</small>
                  </span>
                  <em>🔒</em>
                </button>
                <button
                  type="button"
                  className={styles.layerRow}
                  onClick={() => setShowLogo((current) => !current)}
                >
                  <span className={styles.layerThumbnail}>
                    {logoAsset ? <img src={logoAsset.url} alt="" /> : null}
                  </span>
                  <span>
                    <b>Brand logo</b>
                    <small>{showLogo ? "Visible" : "Hidden"}</small>
                  </span>
                  <em>{showLogo ? "◉" : "○"}</em>
                </button>
              </div>
            ) : null}

            {activeTool === "settings" ? (
              <div className={styles.outputPanel}>
                <strong>Output</strong>
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
                <p>
                  The original file stays unchanged. Atlas saves a separate
                  full-resolution version.
                </p>
              </div>
            ) : null}

            <div className={styles.primaryActions}>
              <a href={studioHref}>Continue in Studio</a>
              <button
                type="button"
                onClick={() => void applyLogo()}
                disabled={!selected || !logoAsset || saving}
              >
                {saving ? "Saving..." : "Save new version"}
              </button>
            </div>
          </aside>

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

      <nav className={styles.mobileDock} aria-label="Image editor shortcuts">
        <button type="button" onClick={() => setActiveTool("images")}>
          <span>▦</span>Images
        </button>
        <button type="button" onClick={() => setActiveTool("logo")}>
          <span>◇</span>Logo
        </button>
        <button type="button" onClick={() => setFullscreen(true)}>
          <span>＋</span>Preview
        </button>
        <button type="button" onClick={() => setActiveTool("layers")}>
          <span>▤</span>Layers
        </button>
        <a href={studioHref}>
          <span>↗</span>Studio
        </a>
      </nav>

      {fullscreen ? (
        <div className={styles.fullscreen} role="dialog" aria-modal="true">
          <header className={styles.fullscreenHeader}>
            <div>
              <strong>{selected?.name}</strong>
              <span>{positionLabel}</span>
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              aria-label="Close preview"
            >
              ×
            </button>
          </header>
          <main className={styles.fullscreenStage}>{renderCanvas(true)}</main>
          <section className={styles.fullscreenControls}>
            {renderLogoControls(true)}
          </section>
          <footer className={styles.fullscreenFooter}>
            <a href={studioHref}>Continue in Studio</a>
            <button
              type="button"
              onClick={() => void applyLogo()}
              disabled={!selected || !logoAsset || saving}
            >
              {saving ? "Saving..." : "Save version"}
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
