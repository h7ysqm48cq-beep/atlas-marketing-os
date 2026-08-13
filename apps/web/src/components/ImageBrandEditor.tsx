"use client";

import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import styles from "./ImageBrandEditorV3.module.css";

const aiEditPresets = [
  {
    id: "premium",
    label: "✨ Make Premium",
    prompt:
      "Transform this image into a premium advertising visual. Improve lighting, composition, depth and overall professional quality while preserving the original subject.",
  },
  {
    id: "cinematic",
    label: "🎬 Cinematic Style",
    prompt:
      "Convert this image into a cinematic style with realistic lighting, depth, film-like atmosphere and premium storytelling composition.",
  },
  {
    id: "lighting",
    label: "💡 Improve Lighting",
    prompt:
      "Improve the lighting, contrast and color balance. Make the image brighter, cleaner and more professional while keeping the original design.",
  },
  {
    id: "background",
    label: "🏙 Change Background",
    prompt:
      "Replace or enhance the background with a realistic premium environment while keeping the main subject unchanged.",
  },
  {
    id: "social",
    label: "📱 Social Optimize",
    prompt:
      "Optimize this image for social media. Improve visual impact, readability and engagement while keeping the original brand identity.",
  },
];

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
type ToolPanel =
  "images" | "logo" | "eraser" | "ai-edit" | "layers" | "settings";

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
  const searchParams = useSearchParams();

  const requestedAssetId = searchParams.get("assetId")?.trim() || "";

  const source = searchParams.get("source")?.trim() || "";

  const conversationId = searchParams.get("conversationId")?.trim() || "";

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
  const [activeTool, setActiveTool] = useState<ToolPanel | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading images...");

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [brushSize, setBrushSize] = useState(64);
  const [drawingMask, setDrawingMask] = useState(false);
  const [maskHistory, setMaskHistory] = useState<string[]>([]);
  const [cleanupPrompt, setCleanupPrompt] = useState("");
  const [eraserBusy, setEraserBusy] = useState(false);

  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [aiEditBusy, setAiEditBusy] = useState(false);

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

        const requestedAssetId =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("assetId")
            : null;

        const requestedAsset = requestedAssetId
          ? assetData.find((asset) => asset.id === requestedAssetId)
          : null;

        setSelectedId(requestedAsset?.id ?? assetData[0]?.id ?? "");

        const activeBrand = Array.isArray(brandData) ? brandData[0] : null;
        const primaryLogoId = activeBrand?.primaryLogoAssetId;
        const logo = primaryLogoId
          ? (assetData.find((asset) => asset.id === primaryLogoId) ?? null)
          : null;
        setLogoAsset(logo);
        if (requestedAssetId && !requestedAsset) {
          setMessage(
            "The requested image could not be found. Showing the latest available image instead.",
          );
        } else if (requestedAsset) {
          setMessage(
            source === "copilot"
              ? "Generated image loaded from Copilot. Preview or edit it below."
              : "Selected Asset Library image loaded.",
          );
        } else {
          setMessage(
            logo
              ? "Tap the image for fullscreen. Open a tool only when needed."
              : assetData.length
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
  }, [requestedAssetId, source]);

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
    if (platform === "Instagram Story" || platform === "WhatsApp Status")
      return "BOTTOM_CENTER";
    if (platform === "Telegram")
      return landscape ? "BOTTOM_RIGHT" : "BOTTOM_CENTER";
    if (platform === "Facebook")
      return portrait ? "BOTTOM_CENTER" : "BOTTOM_RIGHT";
    return portrait ? "BOTTOM_LEFT" : "BOTTOM_RIGHT";
  }, [placement, platform, selected]);

  const logoStyle = useMemo<CSSProperties>(() => {
    const isStory =
      platform === "Instagram Story" || platform === "WhatsApp Status";
    const baseWidth = platform === "Facebook" ? 8.5 : 8;
    const widthPercent = Math.max(5.5, Math.min(15, baseWidth * scale));
    const side = isStory ? "5.5%" : platform === "Telegram" ? "2.8%" : "3.5%";
    const bottom = isStory ? "7.5%" : platform === "Telegram" ? "3%" : "3.5%";
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
    setActiveTool(null);
    setMaskHistory([]);
    setCleanupPrompt("");

    const canvas = maskCanvasRef.current;

    if (canvas) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function toggleTool(tool: ToolPanel) {
    setActiveTool((current) => (current === tool ? null : tool));
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
    event.stopPropagation();
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

  function initialiseMaskCanvas(image: HTMLImageElement) {
    const canvas = maskCanvasRef.current;

    if (!canvas) return;

    if (
      canvas.width === image.naturalWidth &&
      canvas.height === image.naturalHeight
    ) {
      return;
    }

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

    setMaskHistory([]);
  }

  function drawMaskPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");

    if (!context) return;

    const bounds = canvas.getBoundingClientRect();

    const scaleX = canvas.width / bounds.width;

    const scaleY = canvas.height / bounds.height;

    const x = (event.clientX - bounds.left) * scaleX;

    const y = (event.clientY - bounds.top) * scaleY;

    const radius = Math.max(2, (brushSize / 2) * Math.max(scaleX, scaleY));

    context.save();

    context.globalCompositeOperation = "source-over";

    context.fillStyle = "rgba(255, 64, 64, 0.48)";

    context.beginPath();

    context.arc(x, y, radius, 0, Math.PI * 2);

    context.fill();
    context.restore();
  }

  function startMaskDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault();

    const canvas = event.currentTarget;

    setMaskHistory((current) => [
      ...current.slice(-19),
      canvas.toDataURL("image/png"),
    ]);

    canvas.setPointerCapture(event.pointerId);

    setDrawingMask(true);
    drawMaskPoint(event);
  }

  function moveMaskDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingMask) return;

    event.preventDefault();
    drawMaskPoint(event);
  }

  function finishMaskDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setDrawingMask(false);
  }

  function clearMask() {
    const canvas = maskCanvasRef.current;

    if (!canvas) return;

    setMaskHistory((current) => [
      ...current.slice(-19),
      canvas.toDataURL("image/png"),
    ]);

    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function undoMask() {
    const canvas = maskCanvasRef.current;

    if (!canvas || maskHistory.length === 0) {
      return;
    }

    const previous = maskHistory[maskHistory.length - 1];

    const remaining = maskHistory.slice(0, -1);

    const image = new Image();

    image.onload = () => {
      const context = canvas.getContext("2d");

      if (!context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);

      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      setMaskHistory(remaining);
    };

    image.src = previous;
  }

  function createEraseMaskDataUrl() {
    const source = maskCanvasRef.current;

    if (!source) {
      throw new Error("Brush over the area you want to remove first.");
    }

    const sourceContext = source.getContext("2d");

    if (!sourceContext) {
      throw new Error("Unable to read cleanup mask.");
    }

    const pixels = sourceContext.getImageData(
      0,
      0,
      source.width,
      source.height,
    ).data;

    let hasSelection = false;

    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 5) {
        hasSelection = true;
        break;
      }
    }

    if (!hasSelection) {
      throw new Error(
        "Brush over the logo, watermark, text or object you want removed.",
      );
    }

    const output = document.createElement("canvas");

    output.width = source.width;
    output.height = source.height;

    const context = output.getContext("2d");

    if (!context) {
      throw new Error("Unable to create cleanup mask.");
    }

    /*
     * Mask contract:
     * opaque white = preserve
     * transparent = regenerate
     */
    context.fillStyle = "#ffffff";

    context.fillRect(0, 0, output.width, output.height);

    context.globalCompositeOperation = "destination-out";

    context.drawImage(source, 0, 0);

    context.globalCompositeOperation = "source-over";

    return output.toDataURL("image/png");
  }

  async function eraseSelectedArea() {
    if (!selected) return;

    setEraserBusy(true);

    setMessage("Cleaning selected area with AI...");

    try {
      const maskDataUrl = createEraseMaskDataUrl();

      const response = await fetch(`${API_URL}/asset-images/editor/erase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assetId: selected.id,
          maskDataUrl,
          prompt: cleanupPrompt.trim() || undefined,
          name: name.trim() || `${selected.name} · Cleaned`,
        }),
      });

      const responseText = await response.text();

      console.log("[ERASER] API response", {
        status: response.status,
        ok: response.ok,
        body: responseText,
      });

      let data: any = null;

      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        throw new Error(
          `Eraser API returned HTTP ${response.status}: ${responseText || "empty response"}`,
        );
      }

      if (!response.ok || !data?.id) {
        const responseMessage = Array.isArray(data?.message)
          ? data.message.join(" ")
          : data?.message;

        throw new Error(
          `Eraser API HTTP ${response.status}: ${
            responseMessage || data?.error || "Unable to clean selected area."
          }`,
        );
      }

      const cleanedAsset = data as Asset;

      setAssets((current) => [
        cleanedAsset,
        ...current.filter((asset) => asset.id !== cleanedAsset.id),
      ]);

      setSelectedId(cleanedAsset.id);

      setResult(cleanedAsset);
      setName("");
      setMaskHistory([]);
      setCleanupPrompt("");
      setActiveTool(null);

      setMessage("Cleaned image saved as a new Asset Library version.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to clean selected area.",
      );
    } finally {
      setEraserBusy(false);
    }
  }

  async function aiEditExistingAsset() {
    if (!selected) return;

    const instruction = aiEditPrompt.trim();

    if (!instruction) {
      setMessage("Please describe the AI edit you want.");
      return;
    }

    setAiEditBusy(true);
    setMessage("Applying AI edit...");

    try {
      const response = await fetch(`${API_URL}/asset-images/editor/ai-edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assetId: selected.id,
          prompt: instruction,
          name: name.trim() || `${selected.name} · AI Edited`,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.id) {
        const responseMessage = Array.isArray(data?.message)
          ? data.message.join(" ")
          : data?.message;

        throw new Error(responseMessage || "Unable to edit image with AI.");
      }

      const editedAsset = data as Asset;

      setAssets((current) => [
        editedAsset,
        ...current.filter((asset) => asset.id !== editedAsset.id),
      ]);

      setSelectedId(editedAsset.id);
      setResult(editedAsset);
      setAiEditPrompt("");
      setName("");

      setMessage("AI edited image saved as a new Asset Library version.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to edit image with AI.",
      );
    } finally {
      setAiEditBusy(false);
    }
  }

  function applyAiPreset(prompt: string) {
    setAiEditPrompt(prompt);
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
    if (!selected)
      return (
        <div className={styles.emptyCanvas}>Choose an image to begin.</div>
      );
    return (
      <div
        className={`${styles.canvas} ${fullscreenMode ? styles.fullscreenCanvas : ""}`}
      >
        <img
          className={styles.sourceImage}
          src={selected.url}
          alt={selected.name}
          draggable={false}
          onLoad={(event) => initialiseMaskCanvas(event.currentTarget)}
          onClick={() => {
            if (!fullscreenMode && !draggingLogo && activeTool !== "eraser") {
              setFullscreen(true);
            }
          }}
        />

        {activeTool === "eraser" && !fullscreenMode ? (
          <canvas
            ref={maskCanvasRef}
            className={styles.eraserCanvas}
            aria-label="Erase selection"
            onPointerDown={startMaskDrawing}
            onPointerMove={moveMaskDrawing}
            onPointerUp={finishMaskDrawing}
            onPointerCancel={finishMaskDrawing}
          />
        ) : null}
        {showSafeArea ? (
          <div
            className={`${styles.safeArea} ${
              platform === "Instagram Story" || platform === "WhatsApp Status"
                ? styles.storySafeArea
                : ""
            }`}
          />
        ) : null}
        {showLogo && logoAsset && activeTool !== "eraser" ? (
          <img
            className={`${styles.logoPreview} ${draggingLogo ? styles.logoDragging : ""}`}
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
          className={`${styles.autoButton} ${placement === "AUTO" && !customPosition ? styles.autoButtonActive : ""}`}
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

  const studioHref = useMemo(() => {
    const params = new URLSearchParams();

    if (selected) {
      params.set("assetId", selected.id);
    }

    params.set("source", "image-editor");

    if (conversationId) {
      params.set("conversationId", conversationId);
    }

    return `/ai-studio?${params.toString()}`;
  }, [conversationId, selected]);

  const copilotHref = useMemo(() => {
    const params = new URLSearchParams();

    if (conversationId) {
      params.set("conversationId", conversationId);
    }

    if (selected) {
      params.set("assetId", selected.id);
    }

    params.set("source", "image-editor");

    const query = params.toString();

    return query ? `/copilot?${query}` : "/copilot";
  }, [conversationId, selected]);

  const toolIcon = (tool: ToolPanel) => {
    if (tool === "images") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    }

    if (tool === "logo") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 21 12 12 21 3 12Z" />
          <path d="M8.5 12h7" />
          <path d="M12 8.5v7" />
        </svg>
      );
    }

    if (tool === "eraser") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7.5 18.5-4-4a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8l-6 6Z" />
          <path d="m9 6 9 9" />
          <path d="M7.5 18.5H21" />
        </svg>
      );
    }

    if (tool === "layers") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 3 9 5-9 5-9-5Z" />
          <path d="m3 12 9 5 9-5" />
          <path d="m3 16 9 5 9-5" />
        </svg>
      );
    }

    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.3h4v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />
      </svg>
    );
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Image Editor</h1>
          <span>{selected?.name || "Choose an image"}</span>
        </div>
        <div className={styles.headerActions}>
          {source === "copilot" || conversationId ? (
            <a href={copilotHref} className={styles.backToCopilot}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
              <span>Back to Copilot</span>
            </a>
          ) : null}

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
            {(
              [
                "images",
                "logo",
                "eraser",
                "ai-edit",
                "layers",
                "settings",
              ] as ToolPanel[]
            ).map((tool) => (
              <button
                type="button"
                key={tool}
                className={activeTool === tool ? styles.activeTool : ""}
                onClick={() => toggleTool(tool)}
              >
                <span className={styles.toolIcon}>{toolIcon(tool)}</span>

                {tool === "settings"
                  ? "Output"
                  : tool === "eraser"
                    ? "Erase"
                    : tool === "ai-edit"
                      ? "AI Edit"
                      : tool[0].toUpperCase() + tool.slice(1)}
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
            <div
              className={styles.preview}
              role="button"
              tabIndex={0}
              aria-label="Open fullscreen preview"
            >
              {renderCanvas()}
            </div>
          </section>

          {activeTool ? (
            <aside className={styles.inspector}>
              <div className={styles.inspectorHeader}>
                <strong>
                  {activeTool === "settings"
                    ? "Output"
                    : activeTool[0].toUpperCase() + activeTool.slice(1)}
                </strong>
                <button
                  type="button"
                  onClick={() => setActiveTool(null)}
                  aria-label="Close tool"
                >
                  ×
                </button>
              </div>

              {activeTool === "images" ? (
                <div className={styles.mobileAssetPanel}>
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
                        <img
                          src={asset.thumbnailUrl || asset.url}
                          alt={asset.name}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeTool === "logo" ? renderLogoControls() : null}

              {activeTool === "eraser" ? (
                <div className={styles.eraserPanel}>
                  <div className={styles.eraserIntro}>
                    <strong>AI Clean Up</strong>

                    <p>
                      Brush over an unwanted logo, watermark, text or object.
                      Atlas will reconstruct the selected area naturally.
                    </p>
                  </div>

                  <label>
                    <span>Brush size · {brushSize}px</span>

                    <input
                      type="range"
                      min="16"
                      max="180"
                      step="4"
                      value={brushSize}
                      onChange={(event) =>
                        setBrushSize(Number(event.target.value))
                      }
                    />
                  </label>

                  <div className={styles.eraserUtilityRow}>
                    <button
                      type="button"
                      onClick={undoMask}
                      disabled={maskHistory.length === 0 || eraserBusy}
                    >
                      Undo
                    </button>

                    <button
                      type="button"
                      onClick={clearMask}
                      disabled={eraserBusy}
                    >
                      Clear mask
                    </button>
                  </div>

                  <label>
                    <span>Clean-up instruction</span>

                    <textarea
                      rows={4}
                      value={cleanupPrompt}
                      onChange={(event) => setCleanupPrompt(event.target.value)}
                      placeholder="Optional: Remove the incorrect logo and reconstruct the background naturally."
                    />
                  </label>

                  <div className={styles.eraserNotice}>
                    <strong>Original protected</strong>

                    <span>
                      Atlas saves the cleaned result as a new Asset Library
                      version.
                    </span>
                  </div>

                  <button
                    type="button"
                    className={styles.eraseAction}
                    disabled={!selected || eraserBusy}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onTouchStart={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();

                      console.log("[ERASER] Remove selected area clicked", {
                        selectedId,
                        eraserBusy,
                        maskHistoryLength: maskHistory.length,
                      });

                      setMessage(
                        "Eraser button clicked — starting clean up...",
                      );

                      void eraseSelectedArea();
                    }}
                  >
                    {eraserBusy ? "Cleaning..." : "Remove selected area"}
                  </button>
                </div>
              ) : null}

              {activeTool === "ai-edit" ? (
                <div className={styles.eraserPanel}>
                  <div className={styles.eraserIntro}>
                    <strong>AI Creative Edit</strong>

                    <p>
                      Describe the changes you want. Atlas will create a new
                      edited Asset Library version.
                    </p>
                  </div>

                  <div className={styles.aiPresetGrid}>
                    {aiEditPresets.map((preset) => (
                      <button
                        type="button"
                        key={preset.id}
                        onClick={() => applyAiPreset(preset.prompt)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <label>
                    <span>AI Edit Instruction</span>

                    <textarea
                      rows={5}
                      value={aiEditPrompt}
                      onChange={(event) => setAiEditPrompt(event.target.value)}
                      placeholder="Example: Make this image more cinematic, improve lighting, and create a premium advertising style."
                    />
                  </label>

                  <button
                    type="button"
                    className={styles.eraseAction}
                    disabled={!selected || aiEditBusy}
                    onClick={() => void aiEditExistingAsset()}
                  >
                    {aiEditBusy ? "Editing..." : "Run AI Edit"}
                  </button>
                </div>
              ) : null}

              {activeTool === "layers" ? (
                <div className={styles.layersPanel}>
                  <button type="button" className={styles.layerRow}>
                    <span className={styles.layerThumbnail}>
                      {selected ? (
                        <img
                          src={selected.thumbnailUrl || selected.url}
                          alt=""
                        />
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
                  <label>
                    <span>New version name</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={
                        selected
                          ? `${selected.name} · Branded`
                          : "Branded image"
                      }
                    />
                  </label>
                  <p>
                    The original stays unchanged. Atlas saves a separate
                    full-resolution version.
                  </p>
                </div>
              ) : null}

              {activeTool !== "eraser" ? (
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
              ) : null}
            </aside>
          ) : null}

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
        <button
          type="button"
          className={activeTool === "images" ? styles.activeTool : ""}
          onClick={() => toggleTool("images")}
        >
          <span className={styles.toolIcon}>{toolIcon("images")}</span>
          Images
        </button>
        <button
          type="button"
          className={activeTool === "logo" ? styles.activeTool : ""}
          onClick={() => toggleTool("logo")}
        >
          <span className={styles.toolIcon}>{toolIcon("logo")}</span>
          Logo
        </button>
        <button
          type="button"
          className={activeTool === "eraser" ? styles.activeTool : ""}
          onClick={() => toggleTool("eraser")}
        >
          <span className={styles.toolIcon}>{toolIcon("eraser")}</span>
          Erase
        </button>

        <button type="button" onClick={() => setFullscreen(true)}>
          <span>＋</span>Preview
        </button>
        <button
          type="button"
          className={activeTool === "layers" ? styles.activeTool : ""}
          onClick={() => toggleTool("layers")}
        >
          <span className={styles.toolIcon}>{toolIcon("layers")}</span>
          Layers
        </button>
        <a href={studioHref}>
          <span className={styles.toolIcon}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 5h5v5" />
              <path d="M10 14 19 5" />
              <path d="M19 13v6H5V5h6" />
            </svg>
          </span>
          Studio
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
