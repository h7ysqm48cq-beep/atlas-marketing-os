"use client";

import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { RuntimeImage } from "./RuntimeImage";
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

type LayerType =
  | "IMAGE"
  | "LOGO"
  | "TEXT"
  | "QR";

type EditorLayer = {
  id: string;
  type: LayerType;
  name: string;
  text?: string;
  qrValue?: string;
  fontSize?: number;
  color?: string;
  x: number;
  y: number;
  opacity: number;
  scale?: number;
  order: number;
  visible: boolean;
  locked: boolean;
};

function createInitialEditorLayers(
  logoVisible = true,
  logoScale = 0.85,
  logoOpacity = 0.9,
): EditorLayer[] {
  return [
    {
      id: "base-image",
      type: "IMAGE",
      name: "Background",
      x: 0.5,
      y: 0.5,
      opacity: 1,
      order: 0,
      visible: true,
      locked: true,
    },
    {
      id: "brand-logo",
      type: "LOGO",
      name: "Brand logo",
      x: 0.92,
      y: 0.92,
      opacity: logoOpacity,
      scale: logoScale,
      order: 1,
      visible: logoVisible,
      locked: false,
    },
  ];
}

type ToolPanel =
  | "images"
  | "logo"
  | "qr"
  | "eraser"
  | "ai-edit"
  | "layers"
  | "settings";

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

function positionForLogoPlacement(
  placement: Exclude<LogoPlacement, "AUTO">,
): NormalizedPosition {
  const positions: Record<
    Exclude<LogoPlacement, "AUTO">,
    NormalizedPosition
  > = {
    TOP_LEFT: { x: 0.08, y: 0.08 },
    TOP_CENTER: { x: 0.5, y: 0.08 },
    TOP_RIGHT: { x: 0.92, y: 0.08 },

    CENTER_LEFT: { x: 0.08, y: 0.5 },
    CENTER: { x: 0.5, y: 0.5 },
    CENTER_RIGHT: { x: 0.92, y: 0.5 },

    BOTTOM_LEFT: { x: 0.08, y: 0.92 },
    BOTTOM_CENTER: { x: 0.5, y: 0.92 },
    BOTTOM_RIGHT: { x: 0.92, y: 0.92 },
  };

  return positions[placement];
}

export function ImageBrandEditor() {
  const searchParams = useSearchParams();

  const requestedAssetId = searchParams.get("assetId")?.trim() || "";

  const source = searchParams.get("source")?.trim() || "";

  const sourceUrl = searchParams.get("sourceUrl")?.trim() || "";

  const directMobileEdit =
    source === "mobile-upload";

  const conversationId = searchParams.get("conversationId")?.trim() || "";

  const [assets, setAssets] = useState<Asset[]>([]);
  const [logoAsset, setLogoAsset] = useState<Asset | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [placement, setPlacement] = useState<LogoPlacement>("AUTO");
  const [platform, setPlatform] = useState("Facebook");
  const [name, setName] = useState("");
  const [result, setResult] = useState<Asset | null>(null);

  /*
   * Phase 3 Layer model.
   *
   * Editor overlays are managed directly by layers[].
   * Saving persists the explicit Layer model through
   * /editor/composite.
   */
  const [layers, setLayers] =
    useState<EditorLayer[]>(() =>
      createInitialEditorLayers(),
    );

  const [selectedLayerId, setSelectedLayerId] =
    useState("brand-logo");

  const [
    draggingLogoLayerId,
    setDraggingLogoLayerId,
  ] = useState<string | null>(null);

  const [
    qrPreviews,
    setQrPreviews,
  ] = useState<
    Record<
      string,
      {
        value: string;
        dataUrl: string;
      }
    >
  >({});

  const [recentQrValues, setRecentQrValues] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem("atlas-image-editor-recent-qr") || "[]",
      );
      return Array.isArray(parsed)
        ? parsed
            .filter(
              (value): value is string =>
                typeof value === "string" && Boolean(value.trim()),
            )
            .slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });

  const [showSafeArea, setShowSafeArea] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolPanel | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading images...");
  const [uploadingOwnImage, setUploadingOwnImage] = useState(false);

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const lastMaskPointRef = useRef<NormalizedPosition | null>(null);

  const viewportPointersRef = useRef<
    Map<number, { x: number; y: number }>
  >(new Map());

  const viewportGestureRef = useRef<{
    startDistance: number;
    startZoom: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  const viewportGestureActiveRef = useRef(false);
  const suppressCanvasClickRef = useRef(false);

  const [brushSize, setBrushSize] = useState(4);
  const [brushMode, setBrushMode] =
    useState<"erase" | "restore">("erase");

  const [brushCursor, setBrushCursor] = useState({
    x: 0,
    y: 0,
    visible: false,
  });

  const [maskRedoHistory, setMaskRedoHistory] =
    useState<string[]>([]);
  const [, setDrawingMask] = useState(false);

  const drawingMaskRef =
    useRef(false);
  const [maskHistory, setMaskHistory] = useState<string[]>([]);
  const [cleanupPrompt, setCleanupPrompt] = useState("");
  const [eraserBusy, setEraserBusy] = useState(false);
  const [eraserStatus, setEraserStatus] = useState("");
  const [eraserStatusKind, setEraserStatusKind] =
    useState<"info" | "success" | "error">("info");

  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [aiEditBusy, setAiEditBusy] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        if (sourceUrl) {
          const directAsset: Asset = {
            id: requestedAssetId || "direct-source",
            name: "Phone photo",
            type: "IMAGE",
            url: sourceUrl,
            thumbnailUrl: sourceUrl,
            platform: null,
            width: null,
            height: null,
          };
          setAssets([directAsset]);
          setSelectedId(directAsset.id);
        }

        const [assetResponse, brandResponse] = await Promise.all([
          fetch(`${API_URL}/assets?type=IMAGE`, { cache: "no-store" }),
          fetch(`${API_URL}/brands`, { cache: "no-store" }),
        ]);
        const assetData = (await assetResponse.json()) as Asset[];
        const brandData = (await brandResponse.json()) as Brand[];
        if (!assetResponse.ok || !Array.isArray(assetData)) {
          throw new Error("Unable to load Asset Library images.");
        }
        const requestedAsset = sourceUrl
          ? {
              id: requestedAssetId || `mobile-source-${Date.now()}`,
              name:
                assetData.find((asset) => asset.id === requestedAssetId)?.name ||
                "Phone photo",
              type: "IMAGE",
              url: sourceUrl,
              thumbnailUrl: sourceUrl,
              platform: null,
              width: null,
              height: null,
            }
          : requestedAssetId
            ? assetData.find((asset) => asset.id === requestedAssetId)
            : null;

        setAssets(
          requestedAsset
            ? [requestedAsset, ...assetData.filter((asset) => asset.id !== requestedAsset.id)]
            : assetData,
        );

        setSelectedId(requestedAsset?.id ?? assetData[0]?.id ?? "");

        const activeBrand = Array.isArray(brandData) ? brandData[0] : null;
        const primaryLogoId = activeBrand?.primaryLogoAssetId;
        const logo = primaryLogoId
          ? (assetData.find((asset) => asset.id === primaryLogoId) ?? null)
          : null;
        setLogoAsset(logo);

      setLayers(
        createInitialEditorLayers(
          Boolean(logo),
        ),
      );

      setSelectedLayerId(
        logo
          ? "brand-logo"
          : "base-image",
      );
        if (requestedAssetId && !requestedAsset) {
          setMessage(
            "The requested image could not be found. Showing the latest available image instead.",
          );
        } else if (requestedAsset) {
          setMessage(
            source === "copilot"
              ? "Generated image loaded from Copilot. Preview or edit it below."
              : directMobileEdit
                ? "Phone photo loaded directly into Mage Editor."
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
  }, [directMobileEdit, requestedAssetId, source, sourceUrl]);

  useEffect(() => {
    if (!fullscreen) return;

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    /*
     * The fullscreen editor is portalled directly
     * into document.body.
     *
     * Hide every other direct body child while the
     * editor is open so Atlas App Shell headers,
     * inspectors and mobile navigation cannot bleed
     * through the fullscreen editor.
     */
    const fullscreenNode =
      document.querySelector<HTMLElement>(
        "[data-atlas-image-editor-fullscreen]",
      );

    const hiddenSiblings =
      Array.from(
        document.body.children,
      )
        .filter(
          (
            child,
          ): child is HTMLElement =>
            child instanceof HTMLElement &&
            child !== fullscreenNode,
        )
        .map((child) => ({
          child,
          visibility:
            child.style.visibility,
          pointerEvents:
            child.style.pointerEvents,
          ariaHidden:
            child.getAttribute(
              "aria-hidden",
            ),
        }));

    for (
      const {
        child,
      } of hiddenSiblings
    ) {
      child.style.visibility =
        "hidden";

      child.style.pointerEvents =
        "none";

      child.setAttribute(
        "aria-hidden",
        "true",
      );
    }

    const onKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape"
      ) {
        setFullscreen(false);
      }
    };

    window.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      document.body.style.overflow =
        previousOverflow;

      for (
        const {
          child,
          visibility,
          pointerEvents,
          ariaHidden,
        } of hiddenSiblings
      ) {
        child.style.visibility =
          visibility;

        child.style.pointerEvents =
          pointerEvents;

        if (
          ariaHidden === null
        ) {
          child.removeAttribute(
            "aria-hidden",
          );
        } else {
          child.setAttribute(
            "aria-hidden",
            ariaHidden,
          );
        }
      }

      window.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [fullscreen]);

  const orderedLayers = useMemo(
    () =>
      [...layers].sort(
        (left, right) =>
          right.order - left.order,
      ),
    [layers],
  );

  const selectedLayer = useMemo(
    () =>
      layers.find(
        (layer) =>
          layer.id === selectedLayerId,
      ) ?? null,
    [layers, selectedLayerId],
  );

  const qrPreviewSignature =
    useMemo(
      () =>
        JSON.stringify(
          layers
            .filter(
              (layer) =>
                layer.type === "QR",
            )
            .map(
              (layer) => [
                layer.id,
                layer.qrValue?.trim() ?? "",
              ],
            ),
        ),
      [layers],
    );

  useEffect(() => {
    const entries =
      JSON.parse(
        qrPreviewSignature,
      ) as Array<
        [string, string]
      >;

    const targets =
      entries.filter(
        ([, value]) =>
          Boolean(value),
      );

    if (!targets.length) {
      return;
    }

    const controller =
      new AbortController();

    const timer =
      window.setTimeout(
        () => {
          void Promise.all(
            targets.map(
              async (
                [id, value],
              ) => {
                try {
                  const response =
                    await fetch(
                      `${API_URL}/asset-images/editor/qr-preview`,
                      {
                        method:
                          "POST",

                        headers: {
                          "Content-Type":
                            "application/json",
                        },

                        body:
                          JSON.stringify({
                            value,
                          }),

                        signal:
                          controller.signal,
                      },
                    );

                  const data =
                    (await response.json()) as {
                      dataUrl?: string;
                      message?:
                        | string
                        | string[];
                    };

                  if (
                    !response.ok ||
                    !data.dataUrl
                  ) {
                    return null;
                  }

                  return {
                    id,
                    value,
                    dataUrl:
                      data.dataUrl,
                  };
                } catch {
                  return null;
                }
              },
            ),
          ).then(
            (results) => {
              if (
                controller.signal
                  .aborted
              ) {
                return;
              }

              const available =
                results.filter(
                  (
                    result,
                  ): result is {
                    id: string;
                    value: string;
                    dataUrl: string;
                  } =>
                    Boolean(result),
                );

              if (
                !available.length
              ) {
                return;
              }

              setQrPreviews(
                (current) => {
                  const next = {
                    ...current,
                  };

                  for (
                    const preview
                    of available
                  ) {
                    next[
                      preview.id
                    ] = {
                      value:
                        preview.value,
                      dataUrl:
                        preview.dataUrl,
                    };
                  }

                  return next;
                },
              );
            },
          );
        },
        250,
      );

    return () => {
      window.clearTimeout(
        timer,
      );

      controller.abort();
    };
  }, [qrPreviewSignature]);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets.filter((asset) => {
      return !query || asset.name.toLowerCase().includes(query);
    });
  }, [assets, search]);

  async function uploadOwnImage(file: File) {
    if (![/^image\/(jpeg|png|webp)$/].some((pattern) => pattern.test(file.type)) || file.size > 10 * 1024 * 1024) {
      setMessage("Choose a JPG, PNG or WEBP image up to 10MB.");
      return;
    }

    setUploadingOwnImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", file.name);
      formData.append("collection", "Image Editor Uploads");
      const response = await fetch(`${API_URL}/assets/upload`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as Asset & { message?: string | string[] };
      if (!response.ok || !data.id) {
        throw new Error(Array.isArray(data.message) ? data.message.join(" ") : data.message || "Unable to upload image.");
      }
      setAssets((current) => [data, ...current.filter((asset) => asset.id !== data.id)]);
      setSelectedId(data.id);
      setMessage("Image uploaded and ready to edit.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to upload image.");
    } finally {
      setUploadingOwnImage(false);
    }
  }

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

  const positionLabel =
    placement === "AUTO"
      ? `Auto: ${resolvedPlacement
          .replaceAll("_", " ")
          .toLowerCase()}`
      : resolvedPlacement
          .replaceAll("_", " ")
          .toLowerCase();

  function logoStyleForEditorLayer(
    layer: EditorLayer,
  ): CSSProperties {
    const baseWidth =
      platform === "Facebook"
        ? 8.5
        : 8;

    const widthPercent =
      Math.max(
        5.5,
        Math.min(
          15,
          baseWidth *
            (layer.scale ?? 0.85),
        ),
      );

    return {
      left: `${layer.x * 100}%`,
      top: `${layer.y * 100}%`,
      width: `${widthPercent}%`,
      opacity: layer.opacity,
      transform: "translate(-50%, -50%)",
      zIndex: 3 + layer.order,
    };
  }


  function qrStyleForEditorLayer(
    layer: EditorLayer,
  ): CSSProperties {
    const sizePercent =
      Math.max(
        7.2,
        Math.min(
          36,
          18 *
            (layer.scale ?? 0.85),
        ),
      );

    return {
      left: `${layer.x * 100}%`,
      top: `${layer.y * 100}%`,
      width: `${sizePercent}%`,
      opacity: layer.opacity,
      transform: "translate(-50%, -50%)",
      zIndex: 3 + layer.order,
    };
  }

  function nextLayerOrder() {
    return (
      Math.max(
        0,
        ...layers.map(
          (layer) => layer.order,
        ),
      ) + 1
    );
  }

  function updateLayer(
    id: string,
    patch: Partial<EditorLayer>,
  ) {
    setLayers((current) =>
      current.map((layer) =>
        layer.id === id
          ? {
              ...layer,
              ...patch,
            }
          : layer,
      ),
    );
  }

  function rememberQrValue(
    value: string,
  ) {
    const normalized =
      value.trim();

    if (!normalized) {
      return;
    }

    setRecentQrValues(
      (current) => {
        const next = [
          normalized,
          ...current.filter(
            (item) =>
              item !== normalized,
          ),
        ].slice(0, 8);

        if (
          typeof window !==
          "undefined"
        ) {
          try {
            window.localStorage.setItem(
              "atlas-image-editor-recent-qr",
              JSON.stringify(next),
            );
          } catch {
            // Ignore localStorage failures.
          }
        }

        return next;
      },
    );
  }

  function applyRecentQrValue(
    layerId: string,
    value: string,
  ) {
    updateLayer(
      layerId,
      {
        qrValue: value,
      },
    );

    rememberQrValue(value);
  }

  function addLogoLayer() {
    if (!logoAsset) {
      setMessage(
        "No primary brand logo is configured.",
      );
      return;
    }

    const id =
      `brand-logo-${Date.now()}`;

    const layer: EditorLayer = {
      id,
      type: "LOGO",
      name:
        `Brand logo ${
          layers.filter(
            (item) =>
              item.type === "LOGO",
          ).length + 1
        }`,
      x: 0.88,
      y: 0.88,
      opacity: 0.9,
      scale: 0.85,
      order: nextLayerOrder(),
      visible: true,
      locked: false,
    };

    setLayers((current) => [
      ...current,
      layer,
    ]);

    setSelectedLayerId(id);
  }

  function addQrLayer() {
    const id =
      `qr-${crypto.randomUUID()}`;

    const qrCount =
      layers.filter(
        (layer) =>
          layer.type === "QR",
      ).length;

    const layer: EditorLayer = {
      id,
      type: "QR",
      name:
        `QR code ${qrCount + 1}`,
      qrValue: "",
      x: 0.5,
      y: 0.5,
      opacity: 1,
      scale: 0.85,
      order: nextLayerOrder(),
      visible: true,
      locked: false,
    };

    setLayers((current) => [
      ...current,
      layer,
    ]);

    setSelectedLayerId(id);
    setActiveTool("qr");
  }

  function duplicateLayer(
    id: string,
  ) {
    const source =
      layers.find(
        (layer) => layer.id === id,
      );

    if (
      !source ||
      source.type === "IMAGE"
    ) {
      return;
    }

    const duplicateId =
      `${source.type.toLowerCase()}-${Date.now()}`;

    const duplicate: EditorLayer = {
      ...source,
      id: duplicateId,
      name: `${source.name} copy`,
      x: Math.min(
        0.96,
        source.x + 0.04,
      ),
      y: Math.min(
        0.96,
        source.y + 0.04,
      ),
      order: nextLayerOrder(),
      locked: false,
    };

    setLayers((current) => [
      ...current,
      duplicate,
    ]);

    setSelectedLayerId(
      duplicateId,
    );
  }

  function removeLayer(
    id: string,
  ) {
    const target =
      layers.find(
        (layer) => layer.id === id,
      );

    if (
      !target ||
      target.type === "IMAGE" ||
      target.locked
    ) {
      return;
    }

    setLayers((current) =>
      current.filter(
        (layer) =>
          layer.id !== id,
      ),
    );

    setSelectedLayerId(
      "base-image",
    );
  }

  function toggleLayerVisibility(
    id: string,
  ) {
    const target =
      layers.find(
        (layer) => layer.id === id,
      );

    if (!target) return;

    updateLayer(
      id,
      {
        visible:
          !target.visible,
      },
    );
  }

  function toggleLayerLock(
    id: string,
  ) {
    const target =
      layers.find(
        (layer) => layer.id === id,
      );

    if (
      !target ||
      target.type === "IMAGE"
    ) {
      return;
    }

    updateLayer(
      id,
      {
        locked:
          !target.locked,
      },
    );
  }

  function chooseAsset(asset: Asset) {
    setSelectedId(asset.id);
    setResult(null);
    setName("");

    setLayers(
      createInitialEditorLayers(
        Boolean(logoAsset),
      ),
    );

    setSelectedLayerId(
      logoAsset
        ? "brand-logo"
        : "base-image",
    );

    setDraggingLogoLayerId(null);

    setPlacement("AUTO");
    setActiveTool(null);

    setMaskHistory([]);
    setMaskRedoHistory([]);
    setCleanupPrompt("");
    setBrushMode("erase");
    hideBrushCursor();

    setZoom(1);
    setPan({ x: 0, y: 0 });

    viewportPointersRef.current.clear();
    viewportGestureRef.current = null;
    viewportGestureActiveRef.current = false;
    suppressCanvasClickRef.current = false;

    const canvas =
      maskCanvasRef.current;

    if (canvas) {
      canvas
        .getContext("2d")
        ?.clearRect(
          0,
          0,
          canvas.width,
          canvas.height,
        );
    }
  }

  function toggleTool(tool: ToolPanel) {
    if (tool === "eraser") {
      setBrushMode("erase");
    }

    setActiveTool(
      (current) =>
        current === tool
          ? null
          : tool,
    );
  }

  function chooseEraserBrushMode(
    mode: "erase" | "restore",
  ) {
    setBrushMode(mode);

    setMessage(
      mode === "erase"
        ? "Mark Area mode · draw over the area you want AI to remove."
        : "Restore Area mode · brush over the red mask to restore it.",
    );
  }

  function enterEraserTool() {
    setBrushMode("erase");

    drawingMaskRef.current =
      false;

    setDrawingMask(false);

    lastMaskPointRef.current =
      null;

    viewportPointersRef.current.clear();
    viewportGestureRef.current =
      null;
    viewportGestureActiveRef.current =
      false;

    setActiveTool("eraser");
  }

  function toggleQrTool() {
    if (activeTool === "qr") {
      setActiveTool(null);
      return;
    }

    const existingQr =
      selectedLayer?.type === "QR"
        ? selectedLayer
        : orderedLayers.find(
            (layer) =>
              layer.type === "QR",
          );

    if (existingQr) {
      setSelectedLayerId(
        existingQr.id,
      );

      setActiveTool("qr");
      return;
    }

    addQrLayer();
  }

  function clampViewportZoom(value: number) {
    return Math.min(5, Math.max(0.25, value));
  }

  function resetViewport() {
    setZoom(1);
    setPan({ x: 0, y: 0 });

    viewportPointersRef.current.clear();
    viewportGestureRef.current = null;
    viewportGestureActiveRef.current = false;
  }

  function getViewportPointerPair() {
    const pointers = Array.from(
      viewportPointersRef.current.values(),
    );

    if (pointers.length < 2) {
      return null;
    }

    return [pointers[0], pointers[1]] as const;
  }

  function startViewportGesture(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    /*
     * Gesture arbitration:
     *
     * one pointer  = current editing tool
     * two pointers = viewport zoom / pan
     *
     * The first Eraser pointer is allowed through to the
     * mask canvas. Once a second pointer arrives, drawing
     * stops and the viewport owns the gesture.
     */

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    viewportPointersRef.current.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY,
      },
    );

    const pair = getViewportPointerPair();

    if (!pair) {
      return;
    }

    if (activeTool === "eraser") {
      drawingMaskRef.current = false;
      setDrawingMask(false);
      lastMaskPointRef.current = null;

      setBrushCursor((current) => ({
        ...current,
        visible: false,
      }));
    }

    const [first, second] = pair;

    const dx = second.x - first.x;
    const dy = second.y - first.y;

    const distance = Math.max(
      1,
      Math.hypot(dx, dy),
    );

    const centerX =
      (first.x + second.x) / 2;

    const centerY =
      (first.y + second.y) / 2;

    const bounds =
      event.currentTarget.getBoundingClientRect();

    const viewportCenterX =
      bounds.left + bounds.width / 2;

    const viewportCenterY =
      bounds.top + bounds.height / 2;

    viewportGestureRef.current = {
      startDistance: distance,
      startZoom: zoom,

      anchorX:
        (
          centerX -
          viewportCenterX -
          pan.x
        ) / zoom,

      anchorY:
        (
          centerY -
          viewportCenterY -
          pan.y
        ) / zoom,
    };

    viewportGestureActiveRef.current = true;
    suppressCanvasClickRef.current = true;

    setDraggingLogoLayerId(null);

    event.preventDefault();
    event.stopPropagation();
  }

  function moveViewportGesture(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (
      !viewportPointersRef.current.has(
        event.pointerId,
      )
    ) {
      return;
    }

    viewportPointersRef.current.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY,
      },
    );

    const gesture =
      viewportGestureRef.current;

    const pair =
      getViewportPointerPair();

    if (!gesture || !pair) {
      return;
    }

    const [first, second] = pair;

    const dx = second.x - first.x;
    const dy = second.y - first.y;

    const distance = Math.max(
      1,
      Math.hypot(dx, dy),
    );

    const centerX =
      (first.x + second.x) / 2;

    const centerY =
      (first.y + second.y) / 2;

    const nextZoom =
      clampViewportZoom(
        gesture.startZoom *
          (
            distance /
            gesture.startDistance
          ),
      );

    const bounds =
      event.currentTarget.getBoundingClientRect();

    const viewportCenterX =
      bounds.left + bounds.width / 2;

    const viewportCenterY =
      bounds.top + bounds.height / 2;

    setZoom(nextZoom);

    setPan({
      x:
        centerX -
        viewportCenterX -
        gesture.anchorX * nextZoom,

      y:
        centerY -
        viewportCenterY -
        gesture.anchorY * nextZoom,
    });

    event.preventDefault();
    event.stopPropagation();
  }

  function finishViewportGesture(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    const hadGesture =
      viewportGestureActiveRef.current;

    viewportPointersRef.current.delete(
      event.pointerId,
    );

    if (
      viewportPointersRef.current.size < 2
    ) {
      viewportGestureRef.current = null;
      viewportGestureActiveRef.current = false;
    }

    if (
      viewportPointersRef.current.size === 0 &&
      suppressCanvasClickRef.current
    ) {
      window.setTimeout(() => {
        suppressCanvasClickRef.current = false;
      }, 250);
    }

    if (hadGesture) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function updateLogoLayerPosition(
    event: ReactPointerEvent<HTMLElement>,
    layerId: string,
  ) {
    const canvas =
      event.currentTarget.parentElement;

    if (!canvas) return;

    const bounds =
      canvas.getBoundingClientRect();

    if (
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      return;
    }

    const position = {
      x: Math.min(
        0.96,
        Math.max(
          0.04,
          (
            event.clientX -
            bounds.left
          ) / bounds.width,
        ),
      ),

      y: Math.min(
        0.96,
        Math.max(
          0.04,
          (
            event.clientY -
            bounds.top
          ) / bounds.height,
        ),
      ),
    };

    updateLayer(
      layerId,
      position,
    );

  }

  function startLogoDrag(
    event: ReactPointerEvent<HTMLElement>,
    layerId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const layer =
      layers.find(
        (item) =>
          item.id === layerId,
      );

    if (!layer) return;

    setSelectedLayerId(
      layerId,
    );

    if (
      layer.locked ||
      viewportGestureActiveRef.current ||
      viewportPointersRef.current.size >= 2
    ) {
      return;
    }

    event.currentTarget
      .setPointerCapture(
        event.pointerId,
      );

    setDraggingLogoLayerId(
      layerId,
    );

    updateLogoLayerPosition(
      event,
      layerId,
    );
  }

  function moveLogo(
    event: ReactPointerEvent<HTMLElement>,
    layerId: string,
  ) {
    if (
      draggingLogoLayerId !== layerId ||
      viewportGestureActiveRef.current
    ) {
      return;
    }

    updateLogoLayerPosition(
      event,
      layerId,
    );
  }

  function endLogoDrag(
    event: ReactPointerEvent<HTMLElement>,
    layerId: string,
  ) {
    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget
        .releasePointerCapture(
          event.pointerId,
        );
    }

    if (
      draggingLogoLayerId === layerId
    ) {
      setDraggingLogoLayerId(null);
    }
  }

  function initialiseMaskCanvasSize(
    width: number,
    height: number,
  ) {
    const canvas =
      maskCanvasRef.current;

    if (
      !canvas ||
      width <= 0 ||
      height <= 0
    ) {
      return;
    }

    const assetId =
      selected?.id || "";

    if (
      canvas.width === width &&
      canvas.height === height &&
      canvas.dataset.assetId === assetId
    ) {
      return;
    }

    canvas.width = width;
    canvas.height = height;

    canvas.dataset.assetId =
      assetId;

    canvas
      .getContext("2d")
      ?.clearRect(
        0,
        0,
        canvas.width,
        canvas.height,
      );

    setMaskHistory([]);
    setMaskRedoHistory([]);
    setBrushMode("erase");

    drawingMaskRef.current =
      false;

    lastMaskPointRef.current =
      null;
  }

  function initialiseMaskCanvas(
    image: HTMLImageElement,
  ) {
    initialiseMaskCanvasSize(
      image.naturalWidth,
      image.naturalHeight,
    );
  }

  useEffect(() => {
    if (
      activeTool !== "eraser" ||
      !selected
    ) {
      return;
    }

    /*
     * The source image can already be loaded before
     * the Eraser canvas mounts. Wait one frame for
     * maskCanvasRef to exist, then initialise it from
     * the already-loaded source image.
     */
    const frame =
      window.requestAnimationFrame(
        () => {
          const canvas =
            maskCanvasRef.current;

          if (!canvas) {
            return;
          }

          const sourceImage =
            canvas.parentElement
              ?.querySelector(
                `.${styles.sourceImage}`,
              );

          if (
            sourceImage instanceof
              HTMLImageElement &&
            sourceImage.naturalWidth > 0 &&
            sourceImage.naturalHeight > 0
          ) {
            initialiseMaskCanvas(
              sourceImage,
            );

            return;
          }

          if (
            selected.width &&
            selected.height
          ) {
            initialiseMaskCanvasSize(
              selected.width,
              selected.height,
            );
          }
        },
      );

    return () => {
      window.cancelAnimationFrame(
        frame,
      );
    };
  // The frame callback intentionally reads the current selected asset and canvas helpers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTool,
    selected?.id,
    selected?.width,
    selected?.height,
  ]);

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

    context.globalCompositeOperation =
      brushMode === "restore"
        ? "destination-out"
        : "source-over";

    context.fillStyle =
      brushMode === "restore"
        ? "rgba(0, 0, 0, 1)"
        : "rgba(255, 64, 64, 0.52)";

    const previous = lastMaskPointRef.current;

    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = radius * 2;
    context.strokeStyle =
      brushMode === "restore"
        ? "rgba(0, 0, 0, 1)"
        : "rgba(255, 64, 64, 0.52)";
    context.beginPath();

    if (previous) {
      context.moveTo(previous.x, previous.y);
      context.lineTo(x, y);
      context.stroke();
    } else {
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    lastMaskPointRef.current = { x, y };
    context.restore();
  }

  function updateBrushCursor(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    const bounds =
      event.currentTarget.getBoundingClientRect();

    if (
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      return;
    }

    const x = Math.min(
      1,
      Math.max(
        0,
        (event.clientX - bounds.left) /
          bounds.width,
      ),
    );

    const y = Math.min(
      1,
      Math.max(
        0,
        (event.clientY - bounds.top) /
          bounds.height,
      ),
    );

    setBrushCursor({
      x,
      y,
      visible: true,
    });
  }

  function hideBrushCursor() {
    setBrushCursor((current) => ({
      ...current,
      visible: false,
    }));
  }

  function startMaskDrawing(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    /*
     * One pointer = brush.
     * Two pointers = viewport zoom / pan.
     *
     * The viewport capture handler records the first
     * pointer but does not own it until a second
     * pointer appears.
     */
    if (
      viewportPointersRef.current.size >= 2 ||
      viewportGestureActiveRef.current
    ) {
      drawingMaskRef.current = false;
      setDrawingMask(false);
      lastMaskPointRef.current = null;
      hideBrushCursor();
      return;
    }

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    updateBrushCursor(event);

    const canvas =
      event.currentTarget;

    setMaskHistory((current) => [
      ...current.slice(-19),
      canvas.toDataURL("image/png"),
    ]);

    setMaskRedoHistory([]);

    try {
      canvas.setPointerCapture(
        event.pointerId,
      );
    } catch {
      // Some mobile browsers may already own capture.
    }

    lastMaskPointRef.current = null;

    /*
     * Ref is synchronous. Do not depend on React state
     * being committed before the first pointermove.
     */
    drawingMaskRef.current = true;
    setDrawingMask(true);

    /*
     * Immediate visual feedback.
     * A normal tap now creates one brush stamp.
     * The second pinch finger never reaches this point.
     */
    drawMaskPoint(event);
  }

  function moveMaskDrawing(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    updateBrushCursor(event);

    if (
      viewportPointersRef.current.size >= 2 ||
      viewportGestureActiveRef.current
    ) {
      drawingMaskRef.current = false;
      setDrawingMask(false);
      lastMaskPointRef.current = null;
      hideBrushCursor();
      return;
    }

    if (!drawingMaskRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    drawMaskPoint(event);
  }

  function finishMaskDrawing(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      try {
        event.currentTarget.releasePointerCapture(
          event.pointerId,
        );
      } catch {
        // Pointer capture may already have been released.
      }
    }

    drawingMaskRef.current = false;
    setDrawingMask(false);
    lastMaskPointRef.current = null;

    if (
      event.pointerType === "touch"
    ) {
      hideBrushCursor();
    }
  }

  function clearMask() {
    const canvas = maskCanvasRef.current;

    if (!canvas) return;

    setMaskHistory((current) => [
      ...current.slice(-19),
      canvas.toDataURL("image/png"),
    ]);

    setMaskRedoHistory([]);

    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawMaskSnapshot(
    canvas: HTMLCanvasElement,
    snapshot: string,
    onComplete?: () => void,
  ) {
    const image = new Image();

    image.onload = () => {
      const context = canvas.getContext("2d");

      if (!context) return;

      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height,
      );

      context.drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      onComplete?.();
    };

    image.src = snapshot;
  }

  function undoMask() {
    const canvas = maskCanvasRef.current;

    if (!canvas || maskHistory.length === 0) {
      return;
    }

    const previous =
      maskHistory[maskHistory.length - 1];

    const currentSnapshot =
      canvas.toDataURL("image/png");

    setMaskRedoHistory((current) => [
      ...current.slice(-19),
      currentSnapshot,
    ]);

    drawMaskSnapshot(
      canvas,
      previous,
      () => {
        setMaskHistory((current) =>
          current.slice(0, -1),
        );
      },
    );
  }

  function redoMask() {
    const canvas = maskCanvasRef.current;

    if (
      !canvas ||
      maskRedoHistory.length === 0
    ) {
      return;
    }

    const next =
      maskRedoHistory[
        maskRedoHistory.length - 1
      ];

    const currentSnapshot =
      canvas.toDataURL("image/png");

    setMaskHistory((current) => [
      ...current.slice(-19),
      currentSnapshot,
    ]);

    drawMaskSnapshot(
      canvas,
      next,
      () => {
        setMaskRedoHistory((current) =>
          current.slice(0, -1),
        );
      },
    );
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
     *
     * The visible red overlay is intentionally translucent. Convert it to a
     * binary alpha mask here so the selected logo is fully regenerated.
     */
    const maskPixels = context.createImageData(output.width, output.height);

    for (let index = 0; index < maskPixels.data.length; index += 4) {
      const selected = pixels[index + 3] > 5;

      maskPixels.data[index] = 255;
      maskPixels.data[index + 1] = 255;
      maskPixels.data[index + 2] = 255;
      maskPixels.data[index + 3] = selected ? 0 : 255;
    }

    context.putImageData(maskPixels, 0, 0);

    return output.toDataURL("image/png");
  }

  async function eraseSelectedArea(
    mode: "quick" | "ai" = "ai",
  ) {
    if (!selected) return;

    setEraserBusy(true);

    const eraseStartedAt =
      performance.now();

    const workingMessage =
      mode === "quick"
        ? "Quick Remove · repairing selected area..."
        : "AI Remove · reconstructing selected area...";

    setEraserStatusKind("info");
    setEraserStatus(workingMessage);
    setMessage(workingMessage);

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
          mode,
          prompt: cleanupPrompt.trim() || undefined,
          name: (name.trim() || `${selected.name} · Cleaned`).slice(0, 160),
        }),
      });

      const responseText = await response.text();

      let data:
        | (Partial<Asset> & {
            message?: string | string[];
            error?: string;
          })
        | null = null;

      try {
        data = responseText
          ? (JSON.parse(responseText) as Partial<Asset> & {
              message?: string | string[];
              error?: string;
            })
          : null;
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

      /*
       * The cleaned Asset replaces the source image, but it must not
       * inherit a stale iOS pinch gesture.
       *
       * Preserve the current zoom + pan intentionally; only clear
       * transient pointer state.
       */
      viewportPointersRef.current.clear();
      viewportGestureRef.current = null;
      viewportGestureActiveRef.current = false;
      suppressCanvasClickRef.current = false;

      setSelectedId(cleanedAsset.id);

      setResult(cleanedAsset);
      setName("");

      clearMask();

      setMaskHistory([]);
      setMaskRedoHistory([]);
      setCleanupPrompt("");
      setActiveTool(null);

      const elapsedSeconds =
        (
          (
            performance.now() -
            eraseStartedAt
          ) / 1000
        ).toFixed(1);

      const successMessage =
        mode === "quick"
          ? `Quick Remove complete in ${elapsedSeconds}s · saved as a new Asset version.`
          : `AI Remove complete in ${elapsedSeconds}s · saved as a new Asset version.`;

      setEraserStatusKind("success");
      setEraserStatus(successMessage);
      setMessage(successMessage);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to clean selected area.";

      setEraserStatusKind("error");
      setEraserStatus(errorMessage);
      setMessage(errorMessage);
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
          name: (name.trim() || `${selected.name} · AI Edited`).slice(0, 160),
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

  async function saveComposite() {
    if (!selected) return;

    const hasVisibleLogo =
      layers.some(
        (layer) =>
          layer.type === "LOGO" &&
          layer.visible,
      );

    if (
      hasVisibleLogo &&
      !logoAsset
    ) {
      setMessage(
        "A visible Logo layer exists but no primary brand logo is configured.",
      );
      return;
    }

    const visibleQrWithoutValue =
      layers.find(
        (layer) =>
          layer.type === "QR" &&
          layer.visible &&
          !layer.qrValue?.trim(),
      );

    if (visibleQrWithoutValue) {
      setMessage(
        `${visibleQrWithoutValue.name} needs a URL or text before saving.`,
      );
      setSelectedLayerId(
        visibleQrWithoutValue.id,
      );
      setActiveTool("layers");
      return;
    }

    setSaving(true);

    setMessage(
      "Saving editor layers as a new image version...",
    );

    try {
      const response = await fetch(
        `${API_URL}/asset-images/editor/composite`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            assetId:
              selected.id,

            name:
              name.trim() ||
              `${selected.name} · Edited`,

            layers,
          }),
        },
      );

      const data =
        (await response.json()) as Asset & {
          message?: string | string[];
          error?: string;
        };

      if (
        !response.ok ||
        !data.id
      ) {
        const responseMessage =
          Array.isArray(data.message)
            ? data.message.join(" ")
            : data.message;

        throw new Error(
          responseMessage ||
            data.error ||
            "Unable to save editor layers.",
        );
      }

      setResult(data);

      setAssets((current) => [
        data,
        ...current.filter(
          (asset) =>
            asset.id !== data.id,
        ),
      ]);

      setSelectedId(
        data.id,
      );

      /*
       * Saved result is already flattened.
       * Reset overlays so the newly selected asset
       * does not visually show the Logo twice.
       */
      setLayers(
        createInitialEditorLayers(
          false,
        ),
      );

      setSelectedLayerId(
        "base-image",
      );

      setDraggingLogoLayerId(null);
      setPlacement("AUTO");
      setName("");

      setMessage(
        "New edited image saved to Asset Library.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save editor layers.",
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
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transformOrigin: "center center",
        }}
      >
        <RuntimeImage
          width={selected.width || undefined}
          height={selected.height || undefined}
          className={styles.sourceImage}
          src={selected.url}
          alt={selected.name}
          draggable={false}
          onLoad={(event) => initialiseMaskCanvas(event.currentTarget)}
          onClick={() => {
            if (suppressCanvasClickRef.current) {
              return;
            }

            if (
              !fullscreenMode &&
              !draggingLogoLayerId &&
              activeTool !== "eraser"
            ) {
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
            onPointerLeave={hideBrushCursor}
          />
        ) : null}

                {activeTool === "eraser" &&
        !fullscreenMode &&
        brushCursor.visible ? (
          <div
            className={styles.brushCursor}
            aria-hidden="true"
            style={{
              left: `${brushCursor.x * 100}%`,
              top: `${brushCursor.y * 100}%`,
              width: `${Math.max(
                4,
                brushSize / zoom,
              )}px`,
              height: `${Math.max(
                4,
                brushSize / zoom,
              )}px`,
            }}
          >
            <span />
          </div>
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
        {logoAsset &&
        activeTool !== "eraser"
          ? layers
              .filter(
                (layer) =>
                  layer.type === "LOGO" &&
                  layer.visible,
              )
              .sort(
                (left, right) =>
                  left.order -
                  right.order,
              )
              .map((layer) => (
                <RuntimeImage
                  key={layer.id}
                  className={[
                    styles.logoPreview,

                    selectedLayerId ===
                    layer.id
                      ? styles.logoSelected
                      : "",

                    draggingLogoLayerId ===
                    layer.id
                      ? styles.logoDragging
                      : "",

                    layer.locked
                      ? styles.logoLocked
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  src={logoAsset.url}
                  alt={layer.name}
                  style={
                    logoStyleForEditorLayer(
                      layer,
                    )
                  }
                  draggable={false}
                  onPointerDown={(event) =>
                    startLogoDrag(
                      event,
                      layer.id,
                    )
                  }
                  onPointerMove={(event) =>
                    moveLogo(
                      event,
                      layer.id,
                    )
                  }
                  onPointerUp={(event) =>
                    endLogoDrag(
                      event,
                      layer.id,
                    )
                  }
                  onPointerCancel={(event) =>
                    endLogoDrag(
                      event,
                      layer.id,
                    )
                  }
                />
              ))
          : null}

        {activeTool !== "eraser"
          ? layers
              .filter(
                (layer) =>
                  layer.type === "QR" &&
                  layer.visible,
              )
              .sort(
                (left, right) =>
                  left.order -
                  right.order,
              )
              .map((layer) => (
                <div
                  key={layer.id}
                  role="img"
                  aria-label={layer.name}
                  className={[
                    styles.qrPreview,

                    selectedLayerId ===
                    layer.id
                      ? styles.qrSelected
                      : "",

                    draggingLogoLayerId ===
                    layer.id
                      ? styles.qrDragging
                      : "",

                    layer.locked
                      ? styles.qrLocked
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={
                    qrStyleForEditorLayer(
                      layer,
                    )
                  }
                  onPointerDown={(event) =>
                    startLogoDrag(
                      event,
                      layer.id,
                    )
                  }
                  onPointerMove={(event) =>
                    moveLogo(
                      event,
                      layer.id,
                    )
                  }
                  onPointerUp={(event) =>
                    endLogoDrag(
                      event,
                      layer.id,
                    )
                  }
                  onPointerCancel={(event) =>
                    endLogoDrag(
                      event,
                      layer.id,
                    )
                  }
                >
                  {layer.qrValue?.trim() &&
                  qrPreviews[
                    layer.id
                  ]?.value ===
                    layer.qrValue.trim() ? (
                    <RuntimeImage
                      className={styles.qrPreviewImage}
                      src={
                        qrPreviews[
                          layer.id
                        ].dataUrl
                      }
                      alt=""
                      draggable={false}
                    />
                  ) : (
                    <>
                      <span className={styles.qrPattern} />

                      <b>QR</b>

                      <small>
                        {layer.qrValue?.trim()
                          ? "Generating..."
                          : "Add URL / text"}
                      </small>
                    </>
                  )}
                </div>
              ))
          : null}
      </div>
    );
  }

  function renderPositionPicker(
    layer: EditorLayer,
  ) {
    return (
      <div className={styles.positionSection}>
        <div className={styles.positionHeader}>
          <span>Logo position</span>

          <span className={styles.positionCustom}>
            {Math.round(layer.x * 100)}%
            {" · "}
            {Math.round(layer.y * 100)}%
          </span>
        </div>

        <button
          type="button"
          className={styles.autoButton}
          disabled={layer.locked}
          onClick={() => {
            setPlacement("AUTO");

            updateLayer(
              layer.id,
              positionForLogoPlacement(
                resolvedPlacement,
              ),
            );
          }}
        >
          ✦ Auto · Recommended
        </button>

        <div className={styles.positionGrid}>
          {gridPlacements.map((option) => {
            const position =
              positionForLogoPlacement(
                option.value,
              );

            const selectedPosition =
              Math.abs(
                layer.x -
                position.x,
              ) < 0.015 &&
              Math.abs(
                layer.y -
                position.y,
              ) < 0.015;

            return (
              <button
                type="button"
                key={option.value}
                title={option.label}
                aria-label={option.label}
                disabled={layer.locked}
                className={
                  selectedPosition
                    ? styles.positionSelected
                    : ""
                }
                onClick={() => {
                  setPlacement(
                    option.value,
                  );

                  updateLayer(
                    layer.id,
                    position,
                  );
                }}
              >
                {option.mark}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderLogoControls(
    compact = false,
  ) {
    const layer =
      selectedLayer?.type === "LOGO"
        ? selectedLayer
        : null;

    if (!layer) {
      return (
        <div
          className={
            compact
              ? styles.compactControls
              : styles.controls
          }
        >
          <p className={styles.layerEmpty}>
            Select a Logo layer to edit it.
          </p>

          <button
            type="button"
            className={styles.secondaryButton}
            disabled={!logoAsset}
            onClick={addLogoLayer}
          >
            + Add official logo
          </button>
        </div>
      );
    }

    return (
      <div
        className={
          compact
            ? styles.compactControls
            : styles.controls
        }
      >
        {!compact ? (
          <label>
            <span>
              New version name
            </span>

            <input
              value={name}
              onChange={(event) =>
                setName(
                  event.target.value,
                )
              }
              placeholder={
                selected
                  ? `${selected.name} · Edited`
                  : "Edited image"
              }
            />
          </label>
        ) : null}

        <div className={styles.selectedLayerSummary}>
          <strong>
            {layer.name}
          </strong>

          <span>
            {layer.locked
              ? "Locked"
              : "Drag directly on image"}
          </span>
        </div>

        <label>
          <span>Platform</span>

          <select
            value={platform}
            onChange={(event) => {
              setPlatform(
                event.target.value,
              );

              setPlacement("AUTO");
            }}
          >
            <option value="Facebook">
              Facebook
            </option>

            <option value="Telegram">
              Telegram
            </option>

            <option value="Instagram Story">
              Instagram Story
            </option>

            <option value="WhatsApp Status">
              WhatsApp Status
            </option>

            <option value="Multi-platform">
              Multi-platform
            </option>
          </select>
        </label>

        {renderPositionPicker(
          layer,
        )}

        <label>
          <span>
            Logo size ·{" "}
            {Math.round(
              (layer.scale ?? 0.85) *
                100,
            )}
            %
          </span>

          <input
            type="range"
            min="0.4"
            max="2"
            step="0.05"
            value={
              layer.scale ?? 0.85
            }
            disabled={layer.locked}
            onChange={(event) =>
              updateLayer(
                layer.id,
                {
                  scale:
                    Number(
                      event.target.value,
                    ),
                },
              )
            }
          />
        </label>

        <label>
          <span>
            Opacity ·{" "}
            {Math.round(
              layer.opacity * 100,
            )}
            %
          </span>

          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={layer.opacity}
            disabled={layer.locked}
            onChange={(event) =>
              updateLayer(
                layer.id,
                {
                  opacity:
                    Number(
                      event.target.value,
                    ),
                },
              )
            }
          />
        </label>

        <div className={styles.toggleRow}>
          <button
            type="button"
            className={
              layer.visible
                ? styles.activeToggle
                : ""
            }
            onClick={() =>
              toggleLayerVisibility(
                layer.id,
              )
            }
          >
            {layer.visible
              ? "Visible"
              : "Hidden"}
          </button>

          <button
            type="button"
            className={
              layer.locked
                ? styles.activeToggle
                : ""
            }
            onClick={() =>
              toggleLayerLock(
                layer.id,
              )
            }
          >
            {layer.locked
              ? "Locked"
              : "Unlocked"}
          </button>
        </div>

        <div className={styles.layerEditActions}>
          <button
            type="button"
            onClick={() =>
              duplicateLayer(
                layer.id,
              )
            }
          >
            Duplicate
          </button>

          <button
            type="button"
            disabled={layer.locked}
            onClick={() =>
              removeLayer(
                layer.id,
              )
            }
          >
            Delete
          </button>
        </div>

        <div className={styles.toggleRow}>
          <button
            type="button"
            className={
              showSafeArea
                ? styles.activeToggle
                : ""
            }
            onClick={() =>
              setShowSafeArea(
                (current) =>
                  !current,
              )
            }
          >
            Safe area
          </button>

          <button
            type="button"
            onClick={addLogoLayer}
            disabled={!logoAsset}
          >
            + Logo
          </button>
        </div>
      </div>
    );
  }

  function renderQrControls(
    compact = false,
  ) {
    const layer =
      selectedLayer?.type === "QR"
        ? selectedLayer
        : null;

    if (!layer) {
      return null;
    }

    return (
      <div
        className={
          compact
            ? styles.compactControls
            : styles.controls
        }
      >
        <div className={styles.selectedLayerSummary}>
          <strong>
            {layer.name}
          </strong>

          <span>
            {layer.locked
              ? "Locked"
              : "Drag directly on image"}
          </span>
        </div>

        <label>
          <span>
            QR URL / Text
          </span>

          <textarea
            value={
              layer.qrValue ?? ""
            }
            disabled={layer.locked}
            rows={3}
            placeholder="https://example.com"
            onChange={(event) => {
              updateLayer(
                layer.id,
                {
                  qrValue:
                    event.target.value,
                },
              );
            }}
            onBlur={(event) => {
              const value =
                event.currentTarget.value.trim();

              if (value) {
                rememberQrValue(
                  value,
                );
              }
            }}
          />
        </label>

        {recentQrValues.length ? (
          <div className={styles.recentQrSection}>
            <div className={styles.recentQrHeader}>
              <strong>Recent QR</strong>

              <button
                type="button"
                onClick={() => {
                  setRecentQrValues([]);

                  if (
                    typeof window !==
                    "undefined"
                  ) {
                    try {
                      window.localStorage.removeItem(
                        "atlas-image-editor-recent-qr",
                      );
                    } catch {
                      // Ignore localStorage failures.
                    }
                  }
                }}
              >
                Clear
              </button>
            </div>

            <div className={styles.recentQrList}>
              {recentQrValues.map(
                (value) => (
                  <button
                    type="button"
                    key={value}
                    disabled={layer.locked}
                    onClick={() =>
                      applyRecentQrValue(
                        layer.id,
                        value,
                      )
                    }
                  >
                    <span>
                      {value}
                    </span>
                  </button>
                ),
              )}
            </div>
          </div>
        ) : null}

        <label>
          <span>
            QR size ·{" "}
            {Math.round(
              (layer.scale ?? 0.85) *
                100,
            )}
            %
          </span>

          <input
            type="range"
            min="0.4"
            max="2"
            step="0.05"
            value={
              layer.scale ?? 0.85
            }
            disabled={layer.locked}
            onChange={(event) =>
              updateLayer(
                layer.id,
                {
                  scale:
                    Number(
                      event.target.value,
                    ),
                },
              )
            }
          />
        </label>

        <label>
          <span>
            Opacity ·{" "}
            {Math.round(
              layer.opacity * 100,
            )}
            %
          </span>

          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={layer.opacity}
            disabled={layer.locked}
            onChange={(event) =>
              updateLayer(
                layer.id,
                {
                  opacity:
                    Number(
                      event.target.value,
                    ),
                },
              )
            }
          />
        </label>

        <label>
          <span>
            Horizontal ·{" "}
            {Math.round(
              layer.x * 100,
            )}
            %
          </span>

          <input
            type="range"
            min="0.04"
            max="0.96"
            step="0.01"
            value={layer.x}
            disabled={layer.locked}
            onChange={(event) =>
              updateLayer(
                layer.id,
                {
                  x:
                    Number(
                      event.target.value,
                    ),
                },
              )
            }
          />
        </label>

        <label>
          <span>
            Vertical ·{" "}
            {Math.round(
              layer.y * 100,
            )}
            %
          </span>

          <input
            type="range"
            min="0.04"
            max="0.96"
            step="0.01"
            value={layer.y}
            disabled={layer.locked}
            onChange={(event) =>
              updateLayer(
                layer.id,
                {
                  y:
                    Number(
                      event.target.value,
                    ),
                },
              )
            }
          />
        </label>

        <div className={styles.toggleRow}>
          <button
            type="button"
            className={
              layer.visible
                ? styles.activeToggle
                : ""
            }
            onClick={() =>
              toggleLayerVisibility(
                layer.id,
              )
            }
          >
            {layer.visible
              ? "Visible"
              : "Hidden"}
          </button>

          <button
            type="button"
            className={
              layer.locked
                ? styles.activeToggle
                : ""
            }
            onClick={() =>
              toggleLayerLock(
                layer.id,
              )
            }
          >
            {layer.locked
              ? "Locked"
              : "Unlocked"}
          </button>
        </div>

        <div className={styles.layerEditActions}>
          <button
            type="button"
            onClick={() =>
              duplicateLayer(
                layer.id,
              )
            }
          >
            Duplicate
          </button>

          <button
            type="button"
            disabled={layer.locked}
            onClick={() =>
              removeLayer(
                layer.id,
              )
            }
          >
            Delete
          </button>
        </div>

        <button
          type="button"
          className={styles.secondaryButton}
          onClick={addQrLayer}
        >
          + Add another QR
        </button>

        <p className={styles.qrPreviewNote}>
          Preview and final QR are generated locally by Atlas.
        </p>
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

    if (tool === "qr") {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3Z" />
          <path d="M19 14h2v2" />
          <path d="M19 18h2v3h-3" />
          <path d="M14 19h2v2h-2Z" />
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
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadOwnImage(file);
        }}
      />
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
            <button type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploadingOwnImage}>
              {uploadingOwnImage ? "Uploading..." : "＋ Attach own image"}
            </button>
          </div>
          <div className={styles.assetGrid}>
            {filteredAssets.map((asset) => (
              <button
                type="button"
                key={asset.id}
                className={selectedId === asset.id ? styles.selectedAsset : ""}
                onClick={() => chooseAsset(asset)}
              >
                <RuntimeImage
                  src={asset.thumbnailUrl || asset.url}
                  alt={asset.name}
                  width={asset.width || undefined}
                  height={asset.height || undefined}
                />
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
                "qr",
                "ai-edit",
                "layers",
                "settings",
              ] as ToolPanel[]
            ).map((tool) => (
              <button
                type="button"
                key={tool}
                className={activeTool === tool ? styles.activeTool : ""}
                onClick={() =>
                  tool === "qr"
                    ? toggleQrTool()
                    : toggleTool(tool)
                }
              >
                <span className={styles.toolIcon}>{toolIcon(tool)}</span>

                {tool === "settings"
                  ? "Output"
                  : tool === "ai-edit"
                      ? "AI Edit"
                      : tool === "qr"
                        ? "QR"
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
              <div className={styles.zoomControls}>
                <button type="button" onClick={() => setZoom((value) => clampViewportZoom(value - 0.1))} disabled={zoom <= 0.25}>−</button>
                <button type="button" onClick={resetViewport}>{Math.round(zoom * 100)}%</button>
                <button type="button" onClick={() => setZoom((value) => clampViewportZoom(value + 0.1))} disabled={zoom >= 5}>+</button>
                <button type="button" onClick={() => setFullscreen(true)} disabled={!selected}>Fullscreen</button>
              </div>
            </div>
            <div
              className={styles.preview}
              role="region"
              tabIndex={0}
              aria-label="Image editing canvas"
              onPointerDownCapture={startViewportGesture}
              onPointerMoveCapture={moveViewportGesture}
              onPointerUpCapture={finishViewportGesture}
              onPointerCancelCapture={finishViewportGesture}
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
                    : activeTool === "qr"
                      ? "QR"
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
                  <button type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploadingOwnImage}>
                    {uploadingOwnImage ? "Uploading..." : "＋ Attach own image"}
                  </button>
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
                        <RuntimeImage
                          width={asset.width || undefined}
                          height={asset.height || undefined}
                          src={asset.thumbnailUrl || asset.url}
                          alt={asset.name}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeTool === "logo" ? renderLogoControls() : null}

              {activeTool === "qr" ? renderQrControls() : null}

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
                    <span>Brush · {brushSize}px</span>

                    <input
                      type="range"
                      min="4"
                      max="160"
                      step="2"
                      value={brushSize}
                      onChange={(event) =>
                        setBrushSize(Number(event.target.value))
                      }
                    />
                  </label>

                  <div className={styles.eraserModeRow}>
                    <button
                      type="button"
                      className={
                        brushMode === "erase"
                          ? styles.eraserModeActive
                          : ""
                      }
                      aria-pressed={brushMode === "erase"}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        chooseEraserBrushMode("erase");
                      }}
                      onClick={() => chooseEraserBrushMode("erase")}
                    >
                      <span className={styles.eraserControlIcon}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m7.5 18.5-4-4a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8l-6 6Z" />
                          <path d="m9 6 9 9" />
                          <path d="M7.5 18.5H21" />
                        </svg>
                      </span>
                      <span className={styles.eraserControlLabel}>
                        Mark Area
                      </span>
                    </button>

                    <button
                      type="button"
                      className={
                        brushMode === "restore"
                          ? styles.eraserModeActive
                          : ""
                      }
                      aria-pressed={brushMode === "restore"}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        chooseEraserBrushMode("restore");
                      }}
                      onClick={() => chooseEraserBrushMode("restore")}
                    >
                      <span className={styles.eraserControlIcon}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 12a8 8 0 1 0 2.3-5.7" />
                          <path d="M4 4v6h6" />
                        </svg>
                      </span>
                      <span className={styles.eraserControlLabel}>
                        Restore Area
                      </span>
                    </button>
                  </div>

                  <div className={styles.eraserGestureHint}>
                    <span>1 finger · mark area</span>
                    <span>2 fingers · zoom / move</span>
                  </div>

                  <div className={styles.eraserUtilityRow}>
                    <button
                      type="button"
                      onClick={undoMask}
                      disabled={
                        maskHistory.length === 0 ||
                        eraserBusy
                      }
                      aria-label="Undo"
                      title="Undo"
                    >
                      <span className={styles.eraserUtilityIcon}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 7 4 12l5 5" />
                          <path d="M5 12h8a6 6 0 0 1 6 6" />
                        </svg>
                      </span>
                      <span className={styles.eraserUtilityLabel}>
                        Undo
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={redoMask}
                      disabled={
                        maskRedoHistory.length === 0 ||
                        eraserBusy
                      }
                      aria-label="Redo"
                      title="Redo"
                    >
                      <span className={styles.eraserUtilityIcon}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m15 7 5 5-5 5" />
                          <path d="M19 12h-8a6 6 0 0 0-6 6" />
                        </svg>
                      </span>
                      <span className={styles.eraserUtilityLabel}>
                        Redo
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={clearMask}
                      disabled={eraserBusy}
                      aria-label="Clear selection"
                      title="Clear selection"
                    >
                      <span className={styles.eraserUtilityIcon}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M4 7h16" />
                          <path d="M9 3h6" />
                          <path d="m7 7 1 14h8l1-14" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </span>
                      <span className={styles.eraserUtilityLabel}>
                        Clear
                      </span>
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
                  className={styles.quickEraseAction}
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

                    void eraseSelectedArea("quick");
                  }}
                >
                  <span className={styles.eraseActionIcon}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M13 2 5 14h6l-1 8 9-13h-6Z" />
                    </svg>
                  </span>

                  <span>
                    {eraserBusy ? "Working..." : "Quick Remove"}
                  </span>
                </button>

                <div className={styles.eraseActionHint}>
                  Fast for small logos, watermarks and text
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

                    void eraseSelectedArea("ai");
                  }}
                >
                  {eraserBusy ? "Removing..." : "AI Remove"}
                </button>

                <div className={styles.eraseActionHint}>
                  For complex backgrounds and larger objects
                </div>

                {eraserStatus ? (
                  <div
                    className={`${styles.eraserStatus} ${
                      eraserStatusKind === "error"
                        ? styles.eraserStatusError
                        : eraserStatusKind === "success"
                          ? styles.eraserStatusSuccess
                          : styles.eraserStatusInfo
                    }`}
                    role={
                      eraserStatusKind === "error"
                        ? "alert"
                        : "status"
                    }
                  >
                    {eraserBusy ? (
                      <span
                        className={styles.eraserStatusSpinner}
                        aria-hidden="true"
                      />
                    ) : null}

                    <span>{eraserStatus}</span>
                  </div>
                ) : null}
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
                  <div className={styles.layersHeader}>
                    <strong>
                      Layers · {layers.length}
                    </strong>

                    <div className={styles.layersAddActions}>
                      <button
                        type="button"
                        onClick={addLogoLayer}
                        disabled={!logoAsset}
                      >
                        + Logo
                      </button>

                      <button
                        type="button"
                        onClick={addQrLayer}
                      >
                        + QR
                      </button>
                    </div>
                  </div>

                  {orderedLayers.map((layer) => (
                    <div
                      key={layer.id}
                      className={[
                        styles.layerItem,

                        selectedLayerId ===
                        layer.id
                          ? styles.layerItemSelected
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <button
                        type="button"
                        className={styles.layerRow}
                        onClick={() =>
                          setSelectedLayerId(
                            layer.id,
                          )
                        }
                      >
                        <span className={styles.layerThumbnail}>
                          {layer.type === "IMAGE" ? (
                            selected ? (
                              <RuntimeImage
                                width={
                                  selected.width ||
                                  undefined
                                }
                                height={
                                  selected.height ||
                                  undefined
                                }
                                src={
                                  selected.thumbnailUrl ||
                                  selected.url
                                }
                                alt=""
                              />
                            ) : null
                          ) : layer.type === "LOGO" ? (
                            logoAsset ? (
                              <RuntimeImage
                                src={logoAsset.url}
                                alt=""
                              />
                            ) : null
                          ) : layer.type === "QR" ? (
                            <span className={styles.qrLayerThumbnail}>
                              QR
                            </span>
                          ) : null}
                        </span>

                        <span>
                          <b>{layer.name}</b>

                          <small>
                            {layer.type}
                            {" · "}
                            {layer.visible
                              ? "Visible"
                              : "Hidden"}

                            {layer.locked
                              ? " · Locked"
                              : ""}
                          </small>
                        </span>

                        <em>
                          {selectedLayerId ===
                          layer.id
                            ? "●"
                            : "○"}
                        </em>
                      </button>

                      {layer.type !== "IMAGE" ? (
                        <div className={styles.layerActions}>
                          <button
                            type="button"
                            title="Show / Hide"
                            onClick={() =>
                              toggleLayerVisibility(
                                layer.id,
                              )
                            }
                          >
                            {layer.visible
                              ? "◉"
                              : "○"}
                          </button>

                          <button
                            type="button"
                            title="Lock / Unlock"
                            onClick={() =>
                              toggleLayerLock(
                                layer.id,
                              )
                            }
                          >
                            {layer.locked
                              ? "🔒"
                              : "🔓"}
                          </button>

                          <button
                            type="button"
                            title="Duplicate"
                            onClick={() =>
                              duplicateLayer(
                                layer.id,
                              )
                            }
                          >
                            ⧉
                          </button>

                          <button
                            type="button"
                            title="Delete"
                            disabled={layer.locked}
                            onClick={() =>
                              removeLayer(
                                layer.id,
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}

                  {selectedLayer?.type === "LOGO" ? (
                    <div className={styles.layerInspector}>
                      {renderLogoControls(
                        true,
                      )}
                    </div>
                  ) : selectedLayer?.type === "QR" ? (
                    <div className={styles.layerInspector}>
                      {renderQrControls(
                        true,
                      )}
                    </div>
                  ) : selectedLayer ? (
                    <small>
                      Selected: {selectedLayer.name}
                    </small>
                  ) : null}
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
                    onClick={() => void saveComposite()}
                    disabled={!selected || saving}
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
          <span className={styles.mobileDockLabel}>
            Images
          </span>
        </button>
        <button
          type="button"
          className={activeTool === "logo" ? styles.activeTool : ""}
          onClick={() => toggleTool("logo")}
        >
          <span className={styles.toolIcon}>{toolIcon("logo")}</span>
          <span className={styles.mobileDockLabel}>
            Logo
          </span>
        </button>
        <button
          type="button"
          className={activeTool === "qr" ? styles.activeTool : ""}
          onClick={toggleQrTool}
        >
          <span className={styles.toolIcon}>
            {toolIcon("qr")}
          </span>
          <span className={styles.mobileDockLabel}>
            QR
          </span>
        </button>

        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Preview"
          title="Preview"
        >
          <span className={styles.toolIcon}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </span>
          <span className={styles.mobileDockLabel}>
            Preview
          </span>
        </button>
        <button
          type="button"
          className={activeTool === "layers" ? styles.activeTool : ""}
          onClick={() => toggleTool("layers")}
        >
          <span className={styles.toolIcon}>{toolIcon("layers")}</span>
          <span className={styles.mobileDockLabel}>
            Layers
          </span>
        </button>
        <a href={studioHref}>
          <span className={styles.toolIcon}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 5h5v5" />
              <path d="M10 14 19 5" />
              <path d="M19 13v6H5V5h6" />
            </svg>
          </span>
          <span className={styles.mobileDockLabel}>
            Studio
          </span>
        </a>
      </nav>

      {fullscreen &&
      typeof document !== "undefined"
        ? createPortal(
        <div
          className={styles.fullscreen}
          role="dialog"
          aria-modal="true"
          data-atlas-image-editor-fullscreen
        >
          <header className={styles.fullscreenHeader}>
            <div>
              <strong>{selected?.name}</strong>
              <span>{positionLabel}</span>
            </div>
            <div className={styles.zoomControls}>
              <button type="button" onClick={() => setZoom((value) => clampViewportZoom(value - 0.1))} disabled={zoom <= 0.25}>−</button>
              <button type="button" onClick={resetViewport}>{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => setZoom((value) => clampViewportZoom(value + 0.1))} disabled={zoom >= 5}>+</button>
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              aria-label="Close preview"
            >
              ×
            </button>
          </header>
          <main
            className={styles.fullscreenStage}
            onPointerDownCapture={startViewportGesture}
            onPointerMoveCapture={moveViewportGesture}
            onPointerUpCapture={finishViewportGesture}
            onPointerCancelCapture={finishViewportGesture}
          >
            {renderCanvas(true)}
          </main>
          <section className={styles.fullscreenControls}>
            {selectedLayer?.type === "LOGO"
              ? renderLogoControls(true)
              : selectedLayer?.type === "QR"
                ? renderQrControls(true)
                : (
                  <div className={styles.fullscreenNoLayer}>
                    <span>
                      Select a Logo or QR layer to edit its settings.
                    </span>
                  </div>
                )}
          </section>
          <footer className={styles.fullscreenFooter}>
            <a href={studioHref}>Continue in Studio</a>
            <button
              type="button"
              onClick={() => void saveComposite()}
              disabled={!selected || saving}
            >
              {saving ? "Saving..." : "Save version"}
            </button>
          </footer>
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}
