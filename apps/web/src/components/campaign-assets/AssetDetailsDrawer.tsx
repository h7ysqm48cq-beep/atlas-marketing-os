"use client";

import styles from "./AssetDetailsDrawer.module.css";

type DrawerAsset = {
  id: string;
  name: string;
  type: string;
  provider: string | null;
  platform: string | null;
  prompt: string | null;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
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

export function AssetDetailsDrawer({
  asset,
  studioHref,
  onClose,
  onCopyPrompt,
}: {
  asset: DrawerAsset;
  studioHref: string;
  onClose: () => void;
  onCopyPrompt: () => void;
}) {
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <aside
        className={styles.drawer}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div>
            <span>Creative asset</span>
            <h2>{asset.name}</h2>
          </div>

          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className={styles.preview}>
          {asset.type === "IMAGE" ? (
            <img
              src={asset.thumbnailUrl || asset.url}
              alt={asset.name}
            />
          ) : (
            <strong>{asset.type}</strong>
          )}
        </div>

        <section className={styles.metadata}>
          <Metadata label="Type" value={asset.type} />
          <Metadata
            label="Provider"
            value={asset.provider || "Not provided"}
          />
          <Metadata
            label="Platform"
            value={asset.platform || "Not assigned"}
          />
          <Metadata
            label="Resolution"
            value={
              asset.width && asset.height
                ? `${asset.width} × ${asset.height}`
                : "Not available"
            }
          />
          <Metadata
            label="Campaign"
            value={asset.campaign?.name || "No campaign"}
          />
          <Metadata
            label="History"
            value={asset.history?.topic || "No linked history"}
          />
          <Metadata
            label="Created"
            value={formatDate(asset.createdAt)}
          />
        </section>

        <section className={styles.prompt}>
          <div>
            <span>Source prompt</span>

            <button
              type="button"
              disabled={!asset.prompt}
              onClick={onCopyPrompt}
            >
              Copy prompt
            </button>
          </div>

          <p>{asset.prompt || "No source prompt saved."}</p>
        </section>

        <div className={styles.actions}>
          <a href={asset.url} target="_blank" rel="noreferrer">
            View original
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
              Open history
            </a>
          ) : null}

          <a href={studioHref}>Continue in AI Studio</a>

          {asset.campaign ? (
            <a
              href={`/campaigns/${encodeURIComponent(
                asset.campaign.id,
              )}?tab=assets`}
            >
              Open campaign
            </a>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Metadata({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
