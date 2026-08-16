import Link from "next/link";
import styles from "../CampaignPlanner.module.css";
import { Campaign } from "./campaign-planner.types";

export function CampaignPlannerHero({
  campaign,
}: {
  campaign: Campaign | null;
}) {
  return (
    <section className={styles.hero}>
      <div>
        <Link href="/campaigns" className={styles.backLink}>
          ← Campaigns
        </Link>

        <p className={styles.eyebrow}>AI Campaign Planner</p>

        <h1>{campaign?.name || "Campaign workspace"}</h1>

        <p>
          {campaign?.description ||
            "Plan a complete set of campaign topics from one strategic direction."}
        </p>
      </div>

      <div className={styles.campaignMeta}>
        <span>{campaign?.brand.name || "Brand"}</span>
        <strong>{campaign?.status || "Loading"}</strong>
        <small>
          {campaign?.objective || "No objective configured"}
        </small>
      </div>
    </section>
  );
}
