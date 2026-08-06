"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/api";
import styles from "./ImageEditorV2.module.css";

type ImageAsset = {
  id: string;
  name: string;
  url: string;
  width: number | null;
  height: number | null;
};

type LayerType = "IMAGE" | "LOGO" | "TEXT" | "QR";

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

const BASE_LAYERS: EditorLayer[] = [
  {
    id: "base-image",
    type: "IMAGE",
    name: "Base image",
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
    x: 0.88,
    y: 0.92,
    opacity: 0.9,
    scale: 0.85,
    order: 1,
    visible: true,
    locked: false,
  },
];

export function ImageEditorV2() {
  const [asset, setAsset] = useState<ImageAsset | null>(null);
  const [layers, setLayers] = useState<EditorLayer[]>(BASE_LAYERS);
  const [selectedId, setSelectedId] = useState("brand-logo");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("Loading the latest image...");

  const selectedLayer = useMemo(
    () => layers.find((layer) => layer.id === selectedId) ?? null,
    [layers, selectedId],
  );

  async function loadLatestImage() {
    setIsLoading(true);
    setMessage("Loading the latest image...");

    try {
      const response = await fetch(`${API_URL}/asset-images/editor/latest`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to load the latest Asset Library image.");
      }

      const nextAsset = (await response.json()) as ImageAsset | null;
      setAsset(nextAsset);
      setMessage(
        nextAsset
          ? "Latest image loaded. Add text or QR, arrange layers and save a new version."
          : "No image is available yet. Generate an AI image first.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load image editor.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLatestImage();
  }, []);

  function nextOrder() {
    return Math.max(...layers.map((layer) => layer.order)) + 1;
  }

  function addTextLayer() {
    const count = layers.filter((layer) => layer.type === "TEXT").length + 1;
    const id = `text-${Date.now()}`;
    const nextLayer: EditorLayer = {
      id,
      type: "TEXT",
      name: `Text ${count}`,
      text: "Your headline",
      fontSize: 52,
      color: "#ffffff",
      x: 0.1,
      y: 0.12 + Math.min(count - 1, 4) * 0.1,
      opacity: 1,
      order: nextOrder(),
      visible: true,
      locked: false,
    };

    setLayers((current) => [...current, nextLayer]);
    setSelectedId(id);
  }

  function addQrLayer() {
    const count = layers.filter((layer) => layer.type === "QR").length + 1;
    const id = `qr-${Date.now()}`;
    const nextLayer: EditorLayer = {
      id,
      type: "QR",
      name: `QR ${count}`,
      qrValue: "https://",
      x: 0.82,
      y: 0.78,
      opacity: 1,
      scale: 0.85,
      order: nextOrder(),
      visible: true,
      locked: false,
    };

    setLayers((current) => [...current, nextLayer]);
    setSelectedId(id);
  }

  function updateSelected(patch: Partial<EditorLayer>) {
    if (!selectedLayer || selectedLayer.locked) return;
    setLayers((current) =>
      current.map((layer) =>
        layer.id === selectedLayer.id ? { ...layer, ...patch } : layer,
      ),
    );
  }

  function toggleLayer(id: string, key: "visible" | "locked") {
    setLayers((current) =>
      current.map((layer) =>
        layer.id === id ? { ...layer, [key]: !layer[key] } : layer,
      ),
    );
  }

  function removeLayer(id: string) {
    const target = layers.find((layer) => layer.id === id);
    if (!target || target.type === "IMAGE" || target.locked) return;

    setLayers((current) => current.filter((layer) => layer.id !== id));
    setSelectedId("brand-logo");
  }

  function moveLayer(id: string, direction: -1 | 1) {
    const ordered = [...layers].sort((left, right) => left.order - right.order);
    const index = ordered.findIndex((layer) => layer.id === id);
    const targetIndex = index + direction;

    if (index < 0 || targetIndex < 1 || targetIndex >= ordered.length) return;

    const currentOrder = ordered[index].order;
    ordered[index] = { ...ordered[index], order: ordered[targetIndex].order };
    ordered[targetIndex] = { ...ordered[targetIndex], order: currentOrder };
    setLayers(ordered);
  }

  async function saveNewVersion() {
    if (!asset) return;

    const invalidQr = layers.find(
      (layer) => layer.type === "QR" && layer.visible && !layer.qrValue?.trim(),
    );
    if (invalidQr) {
      setSelectedId(invalidQr.id);
      setMessage("Enter a URL or text for every visible QR layer before saving.");
      return;
    }

    setIsSaving(true);
    setMessage("Compositing logo, text and QR layers...");

    try {
      const response = await fetch(`${API_URL}/asset-images/editor/composite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          name: `${asset.name} · Edited version`,
          layers,
        }),
      });

      const data = (await response.json()) as ImageAsset & {
        message?: string;
        error?: string;
      };

      if (!response.ok || !data.id) {
        throw new Error(data.message || data.error || "Unable to save new version.");
      }

      setAsset(data);
      setMessage("New version saved to Asset Library with logo, text and QR layers.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save new version.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const orderedLayers = [...layers].sort((left, right) => right.order - left.order);
  const previewTextLayers = [...layers]
    .filter((layer) => layer.visible && layer.type === "TEXT")
    .sort((left, right) => left.order - right.order);
  const previewQrLayers = [...layers]
    .filter((layer) => layer.visible && layer.type === "QR" && layer.qrValue?.trim())
    .sort((left, right) => left.order - right.order);

  return (
    <section className={styles.editor}>
      <header className={styles.header}>
        <div>
          <span>Image Editor v2</span>
          <h2>Text + QR + Layers</h2>
          <p>Edit the latest Asset Library image without regenerating the scene.</p>
        </div>

        <div className={styles.headerActions}>
          <button type="button" onClick={() => void loadLatestImage()} disabled={isLoading}>
            Refresh image
          </button>
          <button
            type="button"
            className={styles.saveButton}
            onClick={() => void saveNewVersion()}
            disabled={!asset || isSaving}
          >
            {isSaving ? "Saving..." : "Save new version"}
          </button>
        </div>
      </header>

      <p className={styles.message}>{message}</p>

      <div className={styles.workspace}>
        <div className={styles.previewColumn}>
          <div className={styles.preview}>
            {asset ? (
              <>
                <img src={asset.url} alt={asset.name} />
                {previewTextLayers.map((layer) => (
                  <div
                    key={layer.id}
                    className={styles.textPreview}
                    style={{
                      left: `${layer.x * 100}%`,
                      top: `${layer.y * 100}%`,
                      opacity: layer.opacity,
                      color: layer.color,
                      fontSize: `clamp(14px, ${(layer.fontSize ?? 48) / 16}vw, ${
                        layer.fontSize ?? 48
                      }px)`,
                      zIndex: layer.order + 2,
                    }}
                  >
                    {layer.text}
                  </div>
                ))}
                {previewQrLayers.map((layer) => (
                  <img
                    key={layer.id}
                    className={styles.qrPreview}
                    src={`https://quickchart.io/qr?size=260&margin=1&text=${encodeURIComponent(
                      layer.qrValue || "",
                    )}`}
                    alt={layer.name}
                    style={{
                      left: `${layer.x * 100}%`,
                      top: `${layer.y * 100}%`,
                      opacity: layer.opacity,
                      width: `${Math.round((layer.scale ?? 0.85) * 18)}%`,
                      zIndex: layer.order + 2,
                    }}
                  />
                ))}
                {layers.find((layer) => layer.type === "LOGO" && layer.visible) ? (
                  <div
                    className={styles.logoPlaceholder}
                    style={{
                      left: `${
                        (layers.find((layer) => layer.type === "LOGO")?.x ?? 0.88) *
                        100
                      }%`,
                      top: `${
                        (layers.find((layer) => layer.type === "LOGO")?.y ?? 0.92) *
                        100
                      }%`,
                      opacity:
                        layers.find((layer) => layer.type === "LOGO")?.opacity ?? 0.9,
                    }}
                  >
                    BRAND LOGO
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.emptyPreview}>
                {isLoading ? "Loading image..." : "Generate an image to begin editing."}
              </div>
            )}
          </div>
          {asset ? <small>{asset.name}</small> : null}
        </div>

        <aside className={styles.tools}>
          <div className={styles.toolHeader}>
            <div>
              <span>Layers</span>
              <strong>{layers.length}</strong>
            </div>
            <div className={styles.addActions}>
              <button type="button" onClick={addTextLayer}>+ Text</button>
              <button type="button" onClick={addQrLayer}>+ QR</button>
            </div>
          </div>

          <div className={styles.layerList}>
            {orderedLayers.map((layer) => (
              <article
                key={layer.id}
                className={selectedId === layer.id ? styles.selectedLayer : ""}
                onClick={() => setSelectedId(layer.id)}
              >
                <button type="button" className={styles.layerName}>
                  <span>{layer.type}</span>
                  <strong>{layer.name}</strong>
                </button>
                <div className={styles.layerActions}>
                  <button
                    type="button"
                    title={layer.visible ? "Hide layer" : "Show layer"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLayer(layer.id, "visible");
                    }}
                  >
                    {layer.visible ? "◉" : "○"}
                  </button>
                  <button
                    type="button"
                    title={layer.locked ? "Unlock layer" : "Lock layer"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLayer(layer.id, "locked");
                    }}
                  >
                    {layer.locked ? "▣" : "▢"}
                  </button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); moveLayer(layer.id, 1); }}>↑</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); moveLayer(layer.id, -1); }}>↓</button>
                  {layer.type !== "IMAGE" ? (
                    <button
                      type="button"
                      disabled={layer.locked}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeLayer(layer.id);
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          {selectedLayer ? (
            <section className={styles.inspector}>
              <div>
                <span>Selected layer</span>
                <strong>{selectedLayer.name}</strong>
              </div>

              {selectedLayer.type === "TEXT" ? (
                <label>
                  <span>Text</span>
                  <textarea rows={3} value={selectedLayer.text || ""} disabled={selectedLayer.locked} onChange={(event) => updateSelected({ text: event.target.value })} />
                </label>
              ) : null}

              {selectedLayer.type === "QR" ? (
                <label>
                  <span>QR URL or text</span>
                  <textarea rows={3} value={selectedLayer.qrValue || ""} disabled={selectedLayer.locked} placeholder="https://t.me/yourchannel" onChange={(event) => updateSelected({ qrValue: event.target.value })} />
                </label>
              ) : null}

              {selectedLayer.type === "TEXT" ? (
                <label>
                  <span>Font size · {selectedLayer.fontSize}px</span>
                  <input type="range" min="16" max="120" value={selectedLayer.fontSize || 48} disabled={selectedLayer.locked} onChange={(event) => updateSelected({ fontSize: Number(event.target.value) })} />
                </label>
              ) : null}

              {selectedLayer.type === "TEXT" ? (
                <label>
                  <span>Colour</span>
                  <input type="color" value={selectedLayer.color || "#ffffff"} disabled={selectedLayer.locked} onChange={(event) => updateSelected({ color: event.target.value })} />
                </label>
              ) : null}

              {selectedLayer.type === "LOGO" || selectedLayer.type === "QR" ? (
                <label>
                  <span>{selectedLayer.type === "QR" ? "QR" : "Logo"} size · {Math.round((selectedLayer.scale || 0.85) * 100)}%</span>
                  <input type="range" min="0.4" max="2" step="0.05" value={selectedLayer.scale || 0.85} disabled={selectedLayer.locked} onChange={(event) => updateSelected({ scale: Number(event.target.value) })} />
                </label>
              ) : null}

              {selectedLayer.type !== "IMAGE" ? (
                <>
                  <label>
                    <span>Horizontal · {Math.round(selectedLayer.x * 100)}%</span>
                    <input type="range" min="0" max="1" step="0.01" value={selectedLayer.x} disabled={selectedLayer.locked} onChange={(event) => updateSelected({ x: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>Vertical · {Math.round(selectedLayer.y * 100)}%</span>
                    <input type="range" min="0" max="1" step="0.01" value={selectedLayer.y} disabled={selectedLayer.locked} onChange={(event) => updateSelected({ y: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>Opacity · {Math.round(selectedLayer.opacity * 100)}%</span>
                    <input type="range" min="0" max="1" step="0.05" value={selectedLayer.opacity} disabled={selectedLayer.locked} onChange={(event) => updateSelected({ opacity: Number(event.target.value) })} />
                  </label>
                </>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
