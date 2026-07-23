"use client";

import styles from "./CampaignAssets.module.css";

export function CampaignAssets({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  return (
    <section className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            Campaign Creative Workspace
          </p>

          <h2>Campaign Assets</h2>

          <p>
            Organise images, videos, templates and creative references
            belonging to this campaign.
          </p>
        </div>

        <div className={styles.campaignMeta}>
          <span>{campaignName}</span>
          <strong>Workspace ready</strong>
        </div>
      </header>

      <section className={styles.emptyState}>
        <span>◇</span>

        <h3>No campaign assets loaded yet</h3>

        <p>
          The Assets workspace is now connected to campaign
          <code>{campaignId}</code>. Asset loading will be added in the
          next sprint.
        </p>

        <a href="/assets">
          Open global Asset Library
        </a>
      </section>
    </section>
  );
}
