import styles from "../CampaignStrategy.module.css";
import { StrategyControlsProps } from "./campaign-strategy.types";

const AVAILABLE_PLATFORMS = ["Facebook", "Telegram", "Reels"];

export function StrategyControls({
  durationDays,
  style,
  language,
  platforms,
  isGenerating,
  hasResult,
  message,
  onDurationChange,
  onStyleChange,
  onLanguageChange,
  onTogglePlatform,
  onGenerate,
}: StrategyControlsProps) {
  return (
    <section className={styles.controlPanel}>
      <label>
        <span>Duration</span>
        <select
          value={durationDays}
          onChange={(event) =>
            onDurationChange(Number(event.target.value))
          }
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
      </label>

      <label>
        <span>Style</span>
        <select
          value={style}
          onChange={(event) => onStyleChange(event.target.value)}
        >
          <option>Nostalgia</option>
          <option>Funny</option>
          <option>Motivation</option>
          <option>Lifestyle</option>
          <option>Educational</option>
          <option>Soft Sell</option>
        </select>
      </label>

      <label>
        <span>Language</span>
        <select
          value={language}
          onChange={(event) => onLanguageChange(event.target.value)}
        >
          <option>Chinese</option>
          <option>English</option>
          <option>Bilingual</option>
        </select>
      </label>

      <div className={styles.platformSelector}>
        <span>Platforms</span>

        <div>
          {AVAILABLE_PLATFORMS.map((platform) => {
            const selected = platforms.includes(platform);

            return (
              <button
                type="button"
                key={platform}
                className={selected ? styles.selectedPlatform : ""}
                onClick={() => onTogglePlatform(platform)}
              >
                {selected ? "✓ " : ""}
                {platform}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className={styles.generateButton}
        disabled={isGenerating}
        onClick={onGenerate}
      >
        {isGenerating
          ? "Generating strategy..."
          : hasResult
            ? "✦ Regenerate strategy"
            : "✦ Generate strategy"}
      </button>

      <p className={styles.message}>{message}</p>
    </section>
  );
}
