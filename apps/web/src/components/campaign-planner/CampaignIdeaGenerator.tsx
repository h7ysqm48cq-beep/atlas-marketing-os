import styles from "../CampaignPlanner.module.css";
import { CampaignIdeaGeneratorProps } from "./campaign-planner.types";

export function CampaignIdeaGenerator({
  count,
  direction,
  language,
  style,
  platform,
  status,
  isGenerating,
  onCountChange,
  onDirectionChange,
  onLanguageChange,
  onStyleChange,
  onPlatformChange,
  onSubmit,
}: CampaignIdeaGeneratorProps) {
  return (
    <form className={styles.plannerCard} onSubmit={onSubmit}>
      <div className={styles.cardHeading}>
        <span>Campaign brief</span>
        <h2>Generate the content roadmap</h2>
      </div>

      <label className={styles.field}>
        <span>Number of ideas</span>

        <input
          type="number"
          min={3}
          max={30}
          value={count}
          onChange={(event) =>
            onCountChange(Number(event.target.value))
          }
        />
      </label>

      <label className={styles.field}>
        <span>Strategic direction</span>

        <textarea
          value={direction}
          onChange={(event) =>
            onDirectionChange(event.target.value)
          }
        />
      </label>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Language</span>

          <select
            value={language}
            onChange={(event) =>
              onLanguageChange(event.target.value)
            }
          >
            <option>Chinese</option>
            <option>English</option>
            <option>Bilingual</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Style</span>

          <select
            value={style}
            onChange={(event) =>
              onStyleChange(event.target.value)
            }
          >
            <option>Nostalgia</option>
            <option>Funny</option>
            <option>Motivation</option>
            <option>Lifestyle</option>
            <option>Soft Sell</option>
            <option>Educational</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Platform</span>

          <select
            value={platform}
            onChange={(event) =>
              onPlatformChange(event.target.value)
            }
          >
            <option>Multi-platform</option>
            <option>Facebook</option>
            <option>Telegram</option>
            <option>Reels</option>
          </select>
        </label>
      </div>

      <button
        className={styles.generateButton}
        disabled={isGenerating}
      >
        {isGenerating
          ? "Planning campaign..."
          : "✦ Generate campaign plan"}
      </button>

      <p className={styles.status}>{status}</p>
    </form>
  );
}
