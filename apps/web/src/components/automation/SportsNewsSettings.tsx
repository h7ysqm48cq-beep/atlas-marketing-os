"use client";
import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import styles from "./SportsNewsSettings.module.css";
type Channel = {
  id: string;
  platform: "FACEBOOK" | "TELEGRAM";
  name: string;
  username: string | null;
  status: string;
};

type ChannelOverride = {
  customInstructions?: string | null;
  morningPrompt?: string | null;
  eveningPrompt?: string | null;
  imagePrompt?: string | null;
  morningImagePrompt?: string | null;
  eveningImagePrompt?: string | null;
};

const parseOptionalJson = (text: string): Record<string, unknown> => {
  const value = text.trim();

  if (!value || value === "undefined" || value === "null") {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new Error("The server returned an invalid response. Please try again.");
  }
};

type Settings = {
  enabled: boolean;
  timezone: string;
  morningEnabled: boolean;
  morningTime: string;
  eveningEnabled: boolean;
  eveningTime: string;
  telegramEnabled: boolean;
  telegramChannelId: string | null;
  facebookEnabled: boolean;
  facebookChannelId: string | null;
  morningTelegramEnabled: boolean;
  morningFacebookEnabled: boolean;
  eveningTelegramEnabled: boolean;
  eveningFacebookEnabled: boolean;
  autoPublishEnabled: boolean;
  approvalRequired: boolean;
  language: string;
  sportsKnowledgeEnabled: boolean;
  discussionQuestionEnabled: boolean;
  referenceLinksEnabled: boolean;
  sameDaySourcesOnly: boolean;
  maxSourceAgeHours: number;
  requirePublishedAt: boolean;
  requireSourceUrl: boolean;
  minimumSources: number;
  freshnessFallbackEnabled: boolean;
  customPromptEnabled: boolean;
  systemPrompt: string | null;
  morningPrompt: string | null;
  eveningPrompt: string | null;
  knowledgePrompt: string | null;
  customInstructions: string | null;
  channelOverrides: Record<string, ChannelOverride>;
  imageEnabled: boolean;
  imagePrompt: string | null;
  morningImagePrompt: string | null;
  eveningImagePrompt: string | null;
  imageAspectRatio: string;
  imageTextMode: string;
  imageVisualStyle: string | null;
  logoPosition: string;
  brandFooterEnabled: boolean;
  footerTextEnabled: boolean;
  brandFooterText: string;

  logoAssetId: string | null;
  logoOpacity: number;
  logoMargin: number;

  footerLogoEnabled: boolean;
  footerLogoAssetId: string | null;

  footerQrEnabled: boolean;
  footerQrAssetId: string | null;
  footerQrLink: string | null;

  footerPlacement: string;

  storyMinimum: number;
  storyMaximum: number;
  sportsPriority: string;

  verificationInstructions: string | null;
  imageHeadlineInstructions: string | null;
  visibleCopyInstructions: string | null;

  telegramMorningHeader: string;
  telegramEveningHeader: string;
  telegramSectionLabel: string;

  telegramCtaEnabled: boolean;
  telegramCtaText: string;
  telegramCtaUrl: string;

  telegramShowSummaries: boolean;
  telegramCaptionTarget: number;

  telegramSummaryZhLong: number;
  telegramSummaryEnLong: number;
  telegramSummaryZhMedium: number;
  telegramSummaryEnMedium: number;
  telegramSummaryZhShort: number;
  telegramSummaryEnShort: number;
  telegramSummaryZhCompact: number;
  telegramSummaryEnCompact: number;

  visualDirectorEnabled: boolean;
  visualDirectorPrompt: string | null;
  heroStoryWeight: number;

  singleSportVisualPrompt: string | null;
  multiSportVisualPrompt: string | null;
  completedEventVisualPrompt: string | null;
  upcomingEventVisualPrompt: string | null;
  developmentVisualPrompt: string | null;

  morningVisualDirection: string | null;
  eveningVisualDirection: string | null;

  imagePhotographyPrompt: string | null;
  imageNegativePrompt: string | null;
  imageUpperSafeAreaPrompt: string | null;
  imageLowerSafeAreaPrompt: string | null;

  imageLayoutEnabled: boolean;
  storyPanelEnabled: boolean;
  mastheadEnabled: boolean;
  headlineTextEnabled: boolean;

  mastheadScale: number;
  mastheadTopPercent: number;

  highlightsPanelWidthPercent: number;
  highlightsPanelHeightPercent: number;
  highlightsPanelTopPercent: number;
  highlightsPanelOpacityStart: number;
  highlightsPanelOpacityMiddle: number;
  highlightsPanelOpacityEnd: number;
  highlightsPanelRadius: number;

  heroHeadlineScale: number;
  secondaryHeadlineScale: number;

  story02PositionPercent: number;
  story03PositionPercent: number;

  footerHeightPercent: number;

  qrEnabled: boolean;
  qrLink: string;

  mastheadBrandText: string;

  morningEditionZh: string;
  eveningEditionZh: string;
  morningEditionEn: string;
  eveningEditionEn: string;

  imageSectionLabel: string;

  morningAccentColor: string;
  eveningAccentColor: string;
  morningSecondaryColor: string;
  eveningSecondaryColor: string;

  mastheadPrimaryColor: string;
  mastheadEnglishColor: string;
  headlinePrimaryColor: string;
  headlineSecondaryColor: string;
  panelBaseColor: string;

  watermarkEnabled: boolean;
  watermarkScale: number;
  watermarkOpacity: number;
  watermarkPosition: string;

  qrSizePercent: number;
  qrMarginPercent: number;

  footerDateEnabled: boolean;
  footerDateSeparator: string;
  footerBackgroundColor: string;
  footerSeparatorColor: string;

  imageGenerationSize: string;
  imageGenerationQuality: string;

  footballKeywords: string;
  basketballKeywords: string;
  motorsportKeywords: string;
  motorcycleKeywords: string;
  tennisKeywords: string;
  badmintonKeywords: string;
  baseballKeywords: string;
  combatKeywords: string;

  completedScoreRequired: boolean;
  invalidStoryPolicy: string;
  morningSameDaySourcesOnly: boolean;

  newsAiModel: string;
  newsWebSearchEnabled: boolean;

  imageAiModel: string | null;
  imageGenerationEnabled: boolean;

  duplicateEditionPolicy: string;
  forceRunExistingPolicy: string;
  queueStatusOnCreate: string;

  publishRetryEnabled: boolean;
  publishRetryLimit: number;
  publishRetryDelayMinutes: number;

  generationFailurePolicy: string;
  imageFailurePolicy: string;
  brandingFailurePolicy: string;

  minimumSourcesPerStory: number;
  minimumStoriesPerEdition: number;

  completedEventPolicy: string;
  upcomingEventPolicy: string;
  developmentStoryPolicy: string;

  sourceDeduplicationEnabled: boolean;

  imageRulesEnabled: boolean;
  imageRulesPrompt: string | null;

  imageBrandRulesEnabled: boolean;
  imageBrandRulesPrompt: string | null;

  forceRunEnabled: boolean;
  forceMorningEnabled: boolean;
  forceEveningEnabled: boolean;

  morningPostTitleTemplate: string;
  eveningPostTitleTemplate: string;

  imageModelOverrideEnabled: boolean;

  previewNewsPromptEnabled: boolean;
  previewImagePromptEnabled: boolean;
  previewTelegramCaptionEnabled: boolean;

  recommendedDefaultsVersion: string;

  lastMorningRunAt: string | null;
  lastEveningRunAt: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
};
const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) => (
  <label className={styles.toggleRow}>
    <span>{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  </label>
);
const recommendedDefaults = (current: Settings): Settings => ({
  ...current,

  enabled: true,
  timezone: "Asia/Kuala_Lumpur",

  morningEnabled: true,
  morningTime: "09:00",

  eveningEnabled: true,
  eveningTime: "20:00",

  storyMinimum: 3,
  storyMaximum: 5,

  minimumSources: 2,
  minimumSourcesPerStory: 1,
  minimumStoriesPerEdition: 3,

  sameDaySourcesOnly: true,
  morningSameDaySourcesOnly: false,
  maxSourceAgeHours: 24,

  requirePublishedAt: true,
  requireSourceUrl: false,
  freshnessFallbackEnabled: false,

  completedScoreRequired: true,
  completedEventPolicy: "REQUIRE_FINAL_SCORE",
  upcomingEventPolicy: "ALLOW",
  developmentStoryPolicy: "ALLOW",

  invalidStoryPolicy: "SKIP",
  sourceDeduplicationEnabled: true,

  telegramMorningHeader: "⚡ 满贯门体育早报 | M-Sports Morning",

  telegramEveningHeader: "🌙 满贯门体育晚报 | M-Sports Evening",

  telegramSectionLabel: "🔥 今日焦点 | Top Stories",

  telegramCtaEnabled: true,

  telegramCtaText:
    "立即查看今日体育焦点，加入满贯门 / Follow today’s sports focus with 满贯门",

  telegramCtaUrl: "https://rebrand.ly/mgmbetae0dcf",

  telegramShowSummaries: true,
  telegramCaptionTarget: 940,

  telegramSummaryZhLong: 72,
  telegramSummaryEnLong: 112,

  telegramSummaryZhMedium: 58,
  telegramSummaryEnMedium: 88,

  telegramSummaryZhShort: 46,
  telegramSummaryEnShort: 68,

  telegramSummaryZhCompact: 34,
  telegramSummaryEnCompact: 52,

  imageGenerationEnabled: true,

  imageGenerationSize: "1024x1536",

  imageGenerationQuality: "medium",

  imageModelOverrideEnabled: false,

  imageFailurePolicy: "BLOCK",

  brandingFailurePolicy: "USE_GENERATED_IMAGE",

  imageLayoutEnabled: true,
  storyPanelEnabled: false,
  mastheadEnabled: true,
  headlineTextEnabled: true,

  heroStoryWeight: 65,

  mastheadScale: 1,
  mastheadTopPercent: 0.018,

  highlightsPanelWidthPercent: 0.89,

  highlightsPanelHeightPercent: 0.235,

  highlightsPanelTopPercent: 0.61,

  highlightsPanelOpacityStart: 0.8,

  highlightsPanelOpacityMiddle: 0.6,

  highlightsPanelOpacityEnd: 0.22,

  highlightsPanelRadius: 10,

  heroHeadlineScale: 1,
  secondaryHeadlineScale: 1,

  story02PositionPercent: 0.7,
  story03PositionPercent: 0.89,

  footerHeightPercent: 0.085,

  mastheadBrandText: "M-SPORTS",

  morningEditionZh: "满贯门体育早报",

  eveningEditionZh: "满贯门体育晚报",

  morningEditionEn: "MORNING REPORT",

  eveningEditionEn: "EVENING REPORT",

  imageSectionLabel: "今日焦点  /  TOP STORIES",

  morningAccentColor: "#f0c14b",

  eveningAccentColor: "#d7a449",

  morningSecondaryColor: "#1476d4",

  eveningSecondaryColor: "#b9232f",

  watermarkEnabled: true,
  watermarkScale: 0.72,
  watermarkOpacity: 0.72,
  watermarkPosition: "top-right",

  qrEnabled: false,
  qrLink: "https://mgmbetmyr.com",

  qrSizePercent: 0.105,
  qrMarginPercent: 0.025,

  brandFooterEnabled: true,
  footerTextEnabled: true,

  brandFooterText: "满贯门 mgmbetmyr.com",

  logoAssetId: null,
  logoMargin: 10,

  footerLogoEnabled: false,
  footerLogoAssetId: null,

  footerQrEnabled: false,
  footerQrAssetId: null,
  footerQrLink: "https://mgmbetmyr.com",

  footerPlacement: "bottom",

  footerDateEnabled: true,

  footerDateSeparator: "  •  ",

  duplicateEditionPolicy: "SKIP",

  forceRunExistingPolicy: "MARK_OLD",

  queueStatusOnCreate: "QUEUED",

  generationFailurePolicy: "BLOCK",

  forceRunEnabled: true,
  forceMorningEnabled: true,
  forceEveningEnabled: true,

  recommendedDefaultsVersion: "v2",
});

function BrandingPreview({ settings }: { settings: Settings }) {
  return (
    <div
      style={{
        borderRadius: 16,
        overflow: "hidden",
        background: "#101820",
        color: "white",
        padding: 20,
        marginTop: 20,
      }}
    >
      {settings.mastheadEnabled && (
        <div>
          <strong>M SPORTS</strong>
          <div>今日体育新闻</div>
        </div>
      )}

      {settings.headlineTextEnabled && (
        <div
          style={{
            marginTop: 20,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          TOP SPORTS STORY
        </div>
      )}

      {settings.storyPanelEnabled && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: "rgba(255,255,255,0.12)",
            borderRadius: 12,
          }}
        >
          Story Panel
          <br />
          01｜Main Highlight
          <br />
          02｜Secondary Story
        </div>
      )}

      {settings.watermarkEnabled && (
        <div
          style={{
            marginTop: 20,
            opacity: settings.watermarkOpacity,
          }}
        >
          MGM WATERMARK
        </div>
      )}

      <div
        style={{
          marginTop: 20,
          borderTop: "1px solid rgba(255,255,255,.2)",
          paddingTop: 10,
        }}
      >
        {settings.footerTextEnabled && <span>满贯门 mgmbetmyr.com</span>}

        {settings.footerQrEnabled && (
          <span
            style={{
              marginLeft: 20,
            }}
          >
            QR
          </span>
        )}
      </div>
    </div>
  );
}

export function SportsNewsSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<"morning" | "evening" | null>(null);
  const [message, setMessage] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`${API_URL}/sports-news/settings`, { cache: "no-store" }),
      fetch(`${API_URL}/sports-news/channels`, { cache: "no-store" }),
    ]);

    if (!a.ok || !b.ok) {
      throw new Error("Unable to load Sports News settings.");
    }

    const settings: Settings = await a.json();
    setS(settings);
    setSavedSnapshot(settings);
    setChannels(await b.json());
  }, []);
  useEffect(() => {
    // Initial remote-state synchronization for this settings screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((e) =>
      setMessage(e instanceof Error ? e.message : "Load failed."),
    );
  }, [load]);
  const patch = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false);
    setS((x) => (x ? { ...x, [k]: v } : x));
  };
  const saveSettings = async (settingsToSave: Settings) => {
    /*
     * GET /sports-news/settings returns Prisma metadata and
     * expanded channel relations together with editable settings.
     *
     * Strip all read-only/runtime fields before PATCH so Prisma
     * receives operator-editable settings only.
     */
    const readOnlyFields = new Set([
      "id",
      "workspaceId",
      "telegramChannel",
      "facebookChannel",
      "createdAt",
      "updatedAt",
      "lastMorningRunAt",
      "lastEveningRunAt",
      "lastRunStatus",
      "lastError",
    ]);
    const editableSettings = Object.fromEntries(
      Object.entries(settingsToSave).filter(
        ([key]) => !readOnlyFields.has(key),
      ),
    );

    const r = await fetch(`${API_URL}/sports-news/settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(editableSettings),
    });

    if (!r.ok) {
      throw new Error(await r.text());
    }

    const saved = (await r.json()) as Settings;

    setS(saved);
    setSavedSnapshot(saved);
    setSaved(true);

    return saved;
  };
  const save = async () => {
    if (!s) return;

    setSaving(true);
    setMessage("");

    try {
      await saveSettings(s);
      setMessage("Sports News settings saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const saveAndRun = async (kind: "morning" | "evening") => {
    if (!s) return;

    setSaving(true);
    setRunning(kind);

    setMessage(
      `Saving settings and running ${
        kind === "morning" ? "Morning" : "Evening"
      } report...`,
    );

    try {
      await saveSettings(s);

      const r = await fetch(`${API_URL}/automation/sports-news/${kind}/force`, {
        method: "POST",
      });

      const responseText = await r.text();

      if (!r.ok) {
        throw new Error(responseText || `Run failed (${r.status}).`);
      }

      const result = parseOptionalJson(responseText);

      setMessage(
        result.skipped
          ? `Saved. Run skipped: ${result.reason ?? "unknown reason"}.`
          : `Saved. ${
              kind === "morning" ? "Morning" : "Evening"
            } run completed successfully.`,
      );

      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save & Run failed.");
    } finally {
      setRunning(null);
      setSaving(false);
    }
  };

  const resetRecommendedDefaults = () => {
    if (!s) return;

    const confirmed = window.confirm(
      "Reset M-Sports settings to the recommended defaults? " +
        "This only changes the form until you press Save.",
    );

    if (!confirmed) {
      return;
    }

    setS(recommendedDefaults(s));

    setMessage("Recommended defaults loaded. Review them, then press Save.");
  };

  const runNow = async (kind: "morning" | "evening") => {
    setRunning(kind);
    setMessage(
      `${kind === "morning" ? "Morning" : "Evening"} report is running...`,
    );
    try {
      const r = await fetch(`${API_URL}/automation/sports-news/${kind}/force`, {
        method: "POST",
      });
      const text = await r.text();
      if (!r.ok) throw new Error(text || `Run failed (${r.status}).`);
      const result = parseOptionalJson(text);
      setMessage(
        result.skipped
          ? `Run skipped: ${result.reason ?? "unknown reason"}.`
          : `${kind === "morning" ? "Morning" : "Evening"} run completed: ${result.status ?? "completed"}. Post ${result.postId ?? "created"}.`,
      );
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Manual run failed.");
      await load().catch(() => undefined);
    } finally {
      setRunning(null);
    }
  };
  if (!s)
    return (
      <section className={styles.panel}>
        Loading Sports News settings...
      </section>
    );
  const tg = channels.filter((c) => c.platform === "TELEGRAM"),
    fb = channels.filter((c) => c.platform === "FACEBOOK");
  const hasChanges = JSON.stringify(s) !== JSON.stringify(savedSnapshot);
  const discardChanges = () => {
    if (!savedSnapshot) return;
    setS(savedSnapshot);
    setSaved(false);
    setMessage("");
  };
  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <p>SPORTS NEWS</p>
          <h2>Sports News Settings</h2>
          <span>
            Control schedules, channels, freshness, prompts, images and
            publishing.
          </span>
        </div>
        <button
          onClick={save}
          disabled={saving || Boolean(running) || !hasChanges}
        >
          {saving
            ? "Saving..."
            : saved && !hasChanges
              ? "Saved ✓"
              : "Save changes"}
        </button>
      </header>
      <div className={styles.panel}>
        <h3>Operations</h3>
        <button
          onClick={resetRecommendedDefaults}
          disabled={saving || Boolean(running)}
        >
          Reset Recommended Defaults
        </button>{" "}
        <button onClick={save} disabled={saving || Boolean(running)}>
          Save Settings
        </button>{" "}
        <button
          onClick={() => saveAndRun("morning")}
          disabled={saving || Boolean(running)}
        >
          Save & Run Morning
        </button>{" "}
        <button
          onClick={() => saveAndRun("evening")}
          disabled={saving || Boolean(running)}
        >
          Save & Run Evening
        </button>
      </div>

      {message && <div className={styles.message}>{message}</div>}
      <div className={styles.panel}>
        <h3>Manual Test</h3>
        <p>
          Run the same full pipeline used by the scheduler. Current saved
          settings are used.
        </p>
        <div>
          <button
            onClick={() => runNow("morning")}
            disabled={Boolean(running) || saving}
          >
            {running === "morning" ? "Running Morning..." : "Run Morning Now"}
          </button>{" "}
          <button
            onClick={() => runNow("evening")}
            disabled={Boolean(running) || saving}
          >
            {running === "evening" ? "Running Evening..." : "Run Evening Now"}
          </button>
        </div>
      </div>
      <div className={styles.grid}>
        <div className={styles.panel}>
          <h3>Schedule & Channels</h3>
          <Toggle
            label="Sports News enabled"
            checked={s.enabled}
            onChange={(v) => patch("enabled", v)}
          />
          <label>
            Timezone
            <input
              value={s.timezone}
              onChange={(e) => patch("timezone", e.target.value)}
            />
          </label>
          <div className={styles.report}>
            <h4>Morning Report</h4>
            <Toggle
              label="Enabled"
              checked={s.morningEnabled}
              onChange={(v) => patch("morningEnabled", v)}
            />
            <label>
              Time
              <input
                type="time"
                value={s.morningTime}
                onChange={(e) => patch("morningTime", e.target.value)}
              />
            </label>
            <Toggle
              label="Publish to Telegram"
              checked={s.morningTelegramEnabled}
              onChange={(v) => patch("morningTelegramEnabled", v)}
            />
            <Toggle
              label="Sync to Facebook"
              checked={s.morningFacebookEnabled}
              onChange={(v) => patch("morningFacebookEnabled", v)}
            />
          </div>
          <div className={styles.report}>
            <h4>Evening Report</h4>
            <Toggle
              label="Enabled"
              checked={s.eveningEnabled}
              onChange={(v) => patch("eveningEnabled", v)}
            />
            <label>
              Time
              <input
                type="time"
                value={s.eveningTime}
                onChange={(e) => patch("eveningTime", e.target.value)}
              />
            </label>
            <Toggle
              label="Publish to Telegram"
              checked={s.eveningTelegramEnabled}
              onChange={(v) => patch("eveningTelegramEnabled", v)}
            />
            <Toggle
              label="Sync to Facebook"
              checked={s.eveningFacebookEnabled}
              onChange={(v) => patch("eveningFacebookEnabled", v)}
            />
          </div>
          <label>
            Telegram channel
            <select
              value={s.telegramChannelId ?? ""}
              onChange={(e) =>
                patch("telegramChannelId", e.target.value || null)
              }
            >
              <option value="">Select channel</option>
              {tg.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </option>
              ))}
            </select>
          </label>
          <label>
            Facebook page
            <select
              value={s.facebookChannelId ?? ""}
              onChange={(e) =>
                patch("facebookChannelId", e.target.value || null)
              }
            >
              <option value="">Select page</option>
              {fb.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.panel}>
          <h3>News Freshness</h3>
          <Toggle
            label="Same-day sources only"
            checked={s.sameDaySourcesOnly}
            onChange={(v) => patch("sameDaySourcesOnly", v)}
          />
          <label>
            Maximum source age (hours)
            <input
              type="number"
              min={1}
              max={168}
              value={s.maxSourceAgeHours}
              onChange={(e) =>
                patch("maxSourceAgeHours", Number(e.target.value))
              }
            />
          </label>
          <Toggle
            label="Require published date"
            checked={s.requirePublishedAt}
            onChange={(v) => patch("requirePublishedAt", v)}
          />
          <Toggle
            label="Require source URL"
            checked={s.requireSourceUrl}
            onChange={(v) => patch("requireSourceUrl", v)}
          />
          <label>
            Minimum verified sources
            <input
              type="number"
              min={1}
              max={20}
              value={s.minimumSources}
              onChange={(e) => patch("minimumSources", Number(e.target.value))}
            />
          </label>
          <Toggle
            label="Allow older-news fallback"
            checked={s.freshnessFallbackEnabled}
            onChange={(v) => patch("freshnessFallbackEnabled", v)}
          />
          <p className={styles.message}>
            Recommended: keep same-day verification ON and fallback OFF. If
            there are not enough verified fresh sources, Atlas should skip
            publishing instead of presenting old news as today&apos;s news.
          </p>
        </div>
        <div className={styles.panel}>
          <h3>Content & Automation</h3>
          <label>
            Language
            <select
              value={s.language}
              onChange={(e) => patch("language", e.target.value)}
            >
              <option value="zh-en">中文 + English</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <Toggle
            label="Sports Knowledge"
            checked={s.sportsKnowledgeEnabled}
            onChange={(v) => patch("sportsKnowledgeEnabled", v)}
          />
          <Toggle
            label="Discussion Question"
            checked={s.discussionQuestionEnabled}
            onChange={(v) => patch("discussionQuestionEnabled", v)}
          />
          <Toggle
            label="Reference Links"
            checked={s.referenceLinksEnabled}
            onChange={(v) => patch("referenceLinksEnabled", v)}
          />
          <Toggle
            label="Auto Publish"
            checked={s.autoPublishEnabled}
            onChange={(v) => patch("autoPublishEnabled", v)}
          />
          <Toggle
            label="Approval Required"
            checked={s.approvalRequired}
            onChange={(v) => patch("approvalRequired", v)}
          />
        </div>
        <div className={styles.panel}>
          <h3>Prompt Settings</h3>
          <Toggle
            label="Use Custom Prompts"
            checked={s.customPromptEnabled}
            onChange={(v) => patch("customPromptEnabled", v)}
          />
          {[
            ["systemPrompt", "System Instructions"],
            ["morningPrompt", "Morning Prompt"],
            ["eveningPrompt", "Evening Prompt"],
            ["knowledgePrompt", "Sports Knowledge Prompt"],
            ["customInstructions", "Custom Instructions"],
          ].map(([k, l]) => (
            <label key={k}>
              {l}
              <textarea
                rows={4}
                value={(s[k as keyof Settings] as string | null) ?? ""}
                onChange={(e) =>
                  patch(k as keyof Settings, e.target.value as never)
                }
              />
            </label>
          ))}
        </div>

        <div className={styles.panel}>
          <h3>Image Settings</h3>

          <BrandingPreview settings={s} />

          <h4>Generation Settings</h4>

          <h4>Image Layout Controls</h4>

          <Toggle
            label="Show Masthead"
            checked={s.mastheadEnabled}
            onChange={(v) => patch("mastheadEnabled", v)}
          />

          <Toggle
            label="Show Headline Text"
            checked={s.headlineTextEnabled}
            onChange={(v) => patch("headlineTextEnabled", v)}
          />

          <Toggle
            label="Show Story Panel"
            checked={s.storyPanelEnabled}
            onChange={(v) => patch("storyPanelEnabled", v)}
          />

          <label>
            Aspect Ratio
            <select
              value={s.imageAspectRatio}
              onChange={(e) => patch("imageAspectRatio", e.target.value)}
            >
              <option>4:5</option>
              <option>1:1</option>
              <option>16:9</option>
              <option>9:16</option>
            </select>
          </label>

          <div className={styles.report}>
            <h4>Image Layout Control</h4>

            <Toggle
              label="Enable Image Layout"
              checked={s.imageLayoutEnabled}
              onChange={(v) => patch("imageLayoutEnabled", v)}
            />

            <Toggle
              label="Show Masthead"
              checked={s.mastheadEnabled}
              onChange={(v) => patch("mastheadEnabled", v)}
            />

            <Toggle
              label="Show Headline Text"
              checked={s.headlineTextEnabled}
              onChange={(v) => patch("headlineTextEnabled", v)}
            />

            <Toggle
              label="Show Story Panel"
              checked={s.storyPanelEnabled}
              onChange={(v) => patch("storyPanelEnabled", v)}
            />

            <label>
              Hero Story Weight (%)
              <input
                type="number"
                min={0}
                max={100}
                value={s.heroStoryWeight ?? 55}
                onChange={(e) =>
                  patch("heroStoryWeight", Number(e.target.value))
                }
              />
            </label>

            <label>
              Maximum Stories
              <input
                type="number"
                min={1}
                max={5}
                value={s.storyMaximum ?? 3}
                onChange={(e) => patch("storyMaximum", Number(e.target.value))}
              />
            </label>
          </div>

          <div className={styles.report}>
            <h4>Footer Branding</h4>

            <Toggle
              label="Brand Footer"
              checked={s.brandFooterEnabled}
              onChange={(v) => patch("brandFooterEnabled", v)}
            />

            <label>
              Footer Text
              <input
                value={s.brandFooterText}
                onChange={(e) => patch("brandFooterText", e.target.value)}
              />
            </label>

            <Toggle
              label="Footer Logo"
              checked={s.footerLogoEnabled}
              onChange={(v) => patch("footerLogoEnabled", v)}
            />

            <Toggle
              label="Footer QR"
              checked={s.footerQrEnabled}
              onChange={(v) => patch("footerQrEnabled", v)}
            />

            {s.footerQrEnabled && (
              <label>
                Footer QR Link
                <input
                  value={s.footerQrLink ?? ""}
                  onChange={(e) => patch("footerQrLink", e.target.value)}
                />
              </label>
            )}
          </div>

          {[
            ["imageVisualStyle", "Visual Style"],
            ["imagePrompt", "Default Image Prompt"],
            ["morningImagePrompt", "Morning Image Prompt"],
            ["eveningImagePrompt", "Evening Image Prompt"],
          ].map(([k, l]) => (
            <label key={k}>
              {l}
              <textarea
                rows={4}
                value={(s[k as keyof Settings] as string | null) ?? ""}
                onChange={(e) =>
                  patch(k as keyof Settings, e.target.value as never)
                }
              />
            </label>
          ))}
        </div>

        <div className={styles.panel}>
          <h3>News Rules</h3>

          <label>
            Minimum Stories
            <input
              type="number"
              min={1}
              max={10}
              value={s.storyMinimum}
              onChange={(e) => patch("storyMinimum", Number(e.target.value))}
            />
          </label>

          <label>
            Maximum Stories
            <input
              type="number"
              min={1}
              max={10}
              value={s.storyMaximum}
              onChange={(e) => patch("storyMaximum", Number(e.target.value))}
            />
          </label>

          <label>
            Sports Priority
            <input
              value={s.sportsPriority}
              onChange={(e) => patch("sportsPriority", e.target.value)}
              placeholder="football,basketball,formula1,badminton..."
            />
          </label>

          {[
            ["verificationInstructions", "Verification Instructions"],
            ["imageHeadlineInstructions", "Image Headline Instructions"],
            ["visibleCopyInstructions", "Visible Copy Instructions"],
          ].map(([k, l]) => (
            <label key={k}>
              {l}
              <textarea
                rows={5}
                value={(s[k as keyof Settings] as string | null) ?? ""}
                onChange={(e) =>
                  patch(k as keyof Settings, e.target.value as never)
                }
              />
            </label>
          ))}
        </div>

        <div className={styles.panel}>
          <h3>Telegram Copy</h3>

          <label>
            Morning Header
            <input
              value={s.telegramMorningHeader}
              onChange={(e) => patch("telegramMorningHeader", e.target.value)}
            />
          </label>

          <label>
            Evening Header
            <input
              value={s.telegramEveningHeader}
              onChange={(e) => patch("telegramEveningHeader", e.target.value)}
            />
          </label>

          <label>
            Section Label
            <input
              value={s.telegramSectionLabel}
              onChange={(e) => patch("telegramSectionLabel", e.target.value)}
            />
          </label>

          <Toggle
            label="Show CTA"
            checked={s.telegramCtaEnabled}
            onChange={(v) => patch("telegramCtaEnabled", v)}
          />

          <label>
            CTA Text
            <textarea
              rows={3}
              value={s.telegramCtaText}
              onChange={(e) => patch("telegramCtaText", e.target.value)}
            />
          </label>

          <label>
            CTA URL
            <input
              value={s.telegramCtaUrl}
              onChange={(e) => patch("telegramCtaUrl", e.target.value)}
            />
          </label>

          <Toggle
            label="Show Story Summaries"
            checked={s.telegramShowSummaries}
            onChange={(v) => patch("telegramShowSummaries", v)}
          />

          <label>
            Caption Target Length
            <input
              type="number"
              min={300}
              max={1000}
              value={s.telegramCaptionTarget}
              onChange={(e) =>
                patch("telegramCaptionTarget", Number(e.target.value))
              }
            />
          </label>

          <h4>Summary Length Budgets</h4>

          {[
            ["telegramSummaryZhLong", "ZH Long"],
            ["telegramSummaryEnLong", "EN Long"],
            ["telegramSummaryZhMedium", "ZH Medium"],
            ["telegramSummaryEnMedium", "EN Medium"],
            ["telegramSummaryZhShort", "ZH Short"],
            ["telegramSummaryEnShort", "EN Short"],
            ["telegramSummaryZhCompact", "ZH Compact"],
            ["telegramSummaryEnCompact", "EN Compact"],
          ].map(([k, l]) => (
            <label key={k}>
              {l}
              <input
                type="number"
                min={0}
                max={300}
                value={s[k as keyof Settings] as number}
                onChange={(e) =>
                  patch(k as keyof Settings, Number(e.target.value) as never)
                }
              />
            </label>
          ))}
        </div>

        <div className={styles.panel}>
          <h3>Visual Director</h3>

          <Toggle
            label="Visual Director Enabled"
            checked={s.visualDirectorEnabled}
            onChange={(v) => patch("visualDirectorEnabled", v)}
          />

          <label>
            Hero Story Weight (%)
            <input
              type="number"
              min={20}
              max={90}
              value={s.heroStoryWeight}
              onChange={(e) => patch("heroStoryWeight", Number(e.target.value))}
            />
          </label>

          {[
            ["visualDirectorPrompt", "Visual Director Instructions"],
            ["singleSportVisualPrompt", "Single Sport Direction"],
            ["multiSportVisualPrompt", "Multi Sport Direction"],
            ["completedEventVisualPrompt", "Completed Event Direction"],
            ["upcomingEventVisualPrompt", "Upcoming Event Direction"],
            ["developmentVisualPrompt", "Development Direction"],
            ["morningVisualDirection", "Morning Visual Direction"],
            ["eveningVisualDirection", "Evening Visual Direction"],
            ["imagePhotographyPrompt", "Photography Direction"],
            ["imageNegativePrompt", "Negative Prompt"],
            ["imageUpperSafeAreaPrompt", "Upper Safe Area Instructions"],
            ["imageLowerSafeAreaPrompt", "Lower Safe Area Instructions"],
          ].map(([k, l]) => (
            <label key={k}>
              {l}
              <textarea
                rows={5}
                value={(s[k as keyof Settings] as string | null) ?? ""}
                onChange={(e) =>
                  patch(k as keyof Settings, e.target.value as never)
                }
              />
            </label>
          ))}
        </div>

        <div className={styles.panel}>
          <h3>Image Layout</h3>

          <Toggle
            label="Deterministic Layout Enabled"
            checked={s.imageLayoutEnabled}
            onChange={(v) => patch("imageLayoutEnabled", v)}
          />

          <label>
            Masthead Scale
            <input
              type="number"
              step="0.05"
              value={s.mastheadScale}
              onChange={(e) => patch("mastheadScale", Number(e.target.value))}
            />
          </label>

          <label>
            Masthead Top Position
            <input
              type="number"
              step="0.001"
              min={0}
              max={1}
              value={s.mastheadTopPercent}
              onChange={(e) =>
                patch("mastheadTopPercent", Number(e.target.value))
              }
            />
          </label>

          {[
            ["highlightsPanelWidthPercent", "Panel Width %"],
            ["highlightsPanelHeightPercent", "Panel Height %"],
            ["highlightsPanelTopPercent", "Panel Top %"],
            ["highlightsPanelOpacityStart", "Panel Opacity Start"],
            ["highlightsPanelOpacityMiddle", "Panel Opacity Middle"],
            ["highlightsPanelOpacityEnd", "Panel Opacity End"],
            ["story02PositionPercent", "Story 02 Position"],
            ["story03PositionPercent", "Story 03 Position"],
            ["footerHeightPercent", "Footer Height %"],
          ].map(([k, l]) => (
            <label key={k}>
              {l}
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={s[k as keyof Settings] as number}
                onChange={(e) =>
                  patch(k as keyof Settings, Number(e.target.value) as never)
                }
              />
            </label>
          ))}

          <label>
            Panel Radius
            <input
              type="number"
              min={0}
              max={100}
              value={s.highlightsPanelRadius}
              onChange={(e) =>
                patch("highlightsPanelRadius", Number(e.target.value))
              }
            />
          </label>

          <label>
            Hero Headline Scale
            <input
              type="number"
              step="0.05"
              value={s.heroHeadlineScale}
              onChange={(e) =>
                patch("heroHeadlineScale", Number(e.target.value))
              }
            />
          </label>

          <label>
            Secondary Headline Scale
            <input
              type="number"
              step="0.05"
              value={s.secondaryHeadlineScale}
              onChange={(e) =>
                patch("secondaryHeadlineScale", Number(e.target.value))
              }
            />
          </label>
        </div>

        <div className={styles.panel}>
          <h3>Typography Control</h3>

          <label>
            <h4>Masthead</h4>
            Masthead Brand Text
            <input
              value={s.mastheadBrandText}
              onChange={(e) => patch("mastheadBrandText", e.target.value)}
            />
          </label>

          <label>
            Morning Edition Chinese
            <input
              value={s.morningEditionZh}
              onChange={(e) => patch("morningEditionZh", e.target.value)}
            />
          </label>

          <label>
            Evening Edition Chinese
            <input
              value={s.eveningEditionZh}
              onChange={(e) => patch("eveningEditionZh", e.target.value)}
            />
          </label>

          <label>
            Morning Edition English
            <input
              value={s.morningEditionEn}
              onChange={(e) => patch("morningEditionEn", e.target.value)}
            />
          </label>

          <label>
            Evening Edition English
            <input
              value={s.eveningEditionEn}
              onChange={(e) => patch("eveningEditionEn", e.target.value)}
            />
          </label>

          <label>
            <h4>Section</h4>
            Image Section Label
            <input
              value={s.imageSectionLabel}
              onChange={(e) => patch("imageSectionLabel", e.target.value)}
            />
          </label>

          {[
            ["morningAccentColor", "Morning Accent"],
            ["eveningAccentColor", "Evening Accent"],
            ["morningSecondaryColor", "Morning Secondary"],
            ["eveningSecondaryColor", "Evening Secondary"],
            ["mastheadPrimaryColor", "Masthead Primary"],
            ["mastheadEnglishColor", "Masthead English"],
            ["headlinePrimaryColor", "Headline Primary"],
            ["headlineSecondaryColor", "Headline Secondary"],
            ["panelBaseColor", "Panel Base RGB"],
          ].map(([k, l]) => (
            <label key={k}>
              {l}
              <input
                value={s[k as keyof Settings] as string}
                onChange={(e) =>
                  patch(k as keyof Settings, e.target.value as never)
                }
              />
            </label>
          ))}
        </div>

        <div className={styles.panel}>
          <h3>Branding Control</h3>

          <Toggle
            label="Watermark Enabled"
            checked={s.watermarkEnabled}
            onChange={(v) => patch("watermarkEnabled", v)}
          />

          <label>
            Watermark Scale
            <input
              type="number"
              step="0.05"
              min={0.1}
              max={2}
              value={s.watermarkScale}
              onChange={(e) => patch("watermarkScale", Number(e.target.value))}
            />
          </label>

          <label>
            Watermark Opacity
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              value={s.watermarkOpacity}
              onChange={(e) =>
                patch("watermarkOpacity", Number(e.target.value))
              }
            />
          </label>

          <label>
            Watermark Position
            <select
              value={s.watermarkPosition}
              onChange={(e) => patch("watermarkPosition", e.target.value)}
            >
              <option value="top-right">Top Right</option>
              <option value="top-left">Top Left</option>
              <option value="bottom-right">Bottom Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="center">Center</option>
            </select>
          </label>

          <label>
            QR Size %
            <input
              type="number"
              min={0.03}
              max={0.3}
              step="0.005"
              value={s.qrSizePercent}
              onChange={(e) => patch("qrSizePercent", Number(e.target.value))}
            />
          </label>

          <label>
            QR Margin %
            <input
              type="number"
              min={0}
              max={0.2}
              step="0.005"
              value={s.qrMarginPercent}
              onChange={(e) => patch("qrMarginPercent", Number(e.target.value))}
            />
          </label>
        </div>

        <div className={styles.panel}>
          <h3>Footer & Date</h3>

          <Toggle
            label="Show Date in Footer"
            checked={s.footerDateEnabled}
            onChange={(v) => patch("footerDateEnabled", v)}
          />

          <label>
            Date Separator
            <input
              value={s.footerDateSeparator}
              onChange={(e) => patch("footerDateSeparator", e.target.value)}
            />
          </label>

          <label>
            Footer Background
            <input
              value={s.footerBackgroundColor}
              onChange={(e) => patch("footerBackgroundColor", e.target.value)}
            />
          </label>

          <label>
            Footer Separator
            <input
              value={s.footerSeparatorColor}
              onChange={(e) => patch("footerSeparatorColor", e.target.value)}
            />
          </label>
        </div>

        <div className={styles.panel}>
          <h3>Image Generation Runtime</h3>

          <label>
            Image Size
            <select
              value={s.imageGenerationSize}
              onChange={(e) => patch("imageGenerationSize", e.target.value)}
            >
              <option value="1024x1536">1024 × 1536</option>
              <option value="1024x1024">1024 × 1024</option>
              <option value="1536x1024">1536 × 1024</option>
            </select>
          </label>

          <label>
            Image Quality
            <select
              value={s.imageGenerationQuality}
              onChange={(e) => patch("imageGenerationQuality", e.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>

        <div className={styles.panel}>
          <h3>Sport Detection Keywords</h3>

          {[
            ["footballKeywords", "Football"],
            ["basketballKeywords", "Basketball"],
            ["motorsportKeywords", "Formula 1 / Motorsport"],
            ["motorcycleKeywords", "MotoGP / Motorcycle"],
            ["tennisKeywords", "Tennis"],
            ["badmintonKeywords", "Badminton"],
            ["baseballKeywords", "Baseball"],
            ["combatKeywords", "Combat Sports"],
          ].map(([k, l]) => (
            <label key={k}>
              {l}
              <textarea
                rows={3}
                value={s[k as keyof Settings] as string}
                onChange={(e) =>
                  patch(k as keyof Settings, e.target.value as never)
                }
              />
            </label>
          ))}
        </div>

        <div className={styles.panel}>
          <h3>Verification Behaviour</h3>

          <Toggle
            label="Completed Event Must Have Final Score"
            checked={s.completedScoreRequired}
            onChange={(v) => patch("completedScoreRequired", v)}
          />

          <Toggle
            label="Morning Same-Day Sources Only"
            checked={s.morningSameDaySourcesOnly}
            onChange={(v) => patch("morningSameDaySourcesOnly", v)}
          />

          <label>
            Invalid Story Policy
            <select
              value={s.invalidStoryPolicy}
              onChange={(e) => patch("invalidStoryPolicy", e.target.value)}
            >
              <option value="SKIP">Skip invalid story</option>
              <option value="BLOCK">Block entire edition</option>
            </select>
          </label>
        </div>

        <div className={styles.panel}>
          <h3>AI Runtime</h3>

          <label>
            News AI Model
            <input
              value={s.newsAiModel}
              onChange={(e) => patch("newsAiModel", e.target.value)}
            />
          </label>

          <Toggle
            label="Enable Web Search"
            checked={s.newsWebSearchEnabled}
            onChange={(v) => patch("newsWebSearchEnabled", v)}
          />

          <Toggle
            label="Override System Image Model"
            checked={s.imageModelOverrideEnabled}
            onChange={(v) => patch("imageModelOverrideEnabled", v)}
          />

          <label>
            Image AI Model
            <select
              value={s.imageAiModel ?? ""}
              disabled={!s.imageModelOverrideEnabled}
              onChange={(e) => patch("imageAiModel", e.target.value)}
            >
              <option value="">Use System Default</option>

              <option value="gpt-image-2">gpt-image-2</option>

              <option value="gpt-image-1">gpt-image-1</option>
            </select>
          </label>

          <Toggle
            label="Image Generation Enabled"
            checked={s.imageGenerationEnabled}
            onChange={(v) => patch("imageGenerationEnabled", v)}
          />

          <Toggle
            label="Additional Image Rules Enabled"
            checked={s.imageRulesEnabled}
            onChange={(v) => patch("imageRulesEnabled", v)}
          />

          <label>
            Image Rules Prompt
            <textarea
              rows={6}
              value={s.imageRulesPrompt ?? ""}
              onChange={(e) => patch("imageRulesPrompt", e.target.value)}
            />
          </label>

          <Toggle
            label="Image Brand Rules Enabled"
            checked={s.imageBrandRulesEnabled}
            onChange={(v) => patch("imageBrandRulesEnabled", v)}
          />

          <label>
            Image Brand Rules Prompt
            <textarea
              rows={6}
              value={s.imageBrandRulesPrompt ?? ""}
              onChange={(e) => patch("imageBrandRulesPrompt", e.target.value)}
            />
          </label>
        </div>

        <div className={styles.panel}>
          <h3>Publishing Behaviour</h3>

          <label>
            Duplicate Edition Policy
            <select
              value={s.duplicateEditionPolicy}
              onChange={(e) => patch("duplicateEditionPolicy", e.target.value)}
            >
              <option value="SKIP">Skip existing</option>
              <option value="REPLACE">Replace existing</option>
              <option value="ALLOW">Allow duplicate</option>
            </select>
          </label>

          <label>
            Force Run Existing Policy
            <select
              value={s.forceRunExistingPolicy}
              onChange={(e) => patch("forceRunExistingPolicy", e.target.value)}
            >
              <option value="MARK_OLD">Mark previous as OLD</option>
              <option value="DELETE">Delete previous</option>
              <option value="KEEP">Keep previous</option>
            </select>
          </label>

          <Toggle
            label="Publish Retry Enabled"
            checked={s.publishRetryEnabled}
            onChange={(v) => patch("publishRetryEnabled", v)}
          />

          <label>
            Retry Limit
            <input
              type="number"
              min={0}
              max={20}
              value={s.publishRetryLimit}
              onChange={(e) =>
                patch("publishRetryLimit", Number(e.target.value))
              }
            />
          </label>

          <label>
            Retry Delay (minutes)
            <input
              type="number"
              min={0}
              max={1440}
              value={s.publishRetryDelayMinutes}
              onChange={(e) =>
                patch("publishRetryDelayMinutes", Number(e.target.value))
              }
            />
          </label>
        </div>

        <div className={styles.panel}>
          <h3>Validation & Failure Policies</h3>

          <label>
            Minimum Sources Per Story
            <input
              type="number"
              min={1}
              max={20}
              value={s.minimumSourcesPerStory}
              onChange={(e) =>
                patch("minimumSourcesPerStory", Number(e.target.value))
              }
            />
          </label>

          <label>
            Minimum Stories Per Edition
            <input
              type="number"
              min={1}
              max={10}
              value={s.minimumStoriesPerEdition}
              onChange={(e) =>
                patch("minimumStoriesPerEdition", Number(e.target.value))
              }
            />
          </label>

          <Toggle
            label="Deduplicate Sources"
            checked={s.sourceDeduplicationEnabled}
            onChange={(v) => patch("sourceDeduplicationEnabled", v)}
          />

          {[
            [
              "generationFailurePolicy",
              "Generation Failure",
              ["BLOCK", "SKIP"],
            ],
            ["imageFailurePolicy", "Image Failure", ["BLOCK", "TEXT_ONLY"]],
            [
              "brandingFailurePolicy",
              "Branding Failure",
              ["BLOCK", "USE_GENERATED_IMAGE"],
            ],
            [
              "completedEventPolicy",
              "Completed Event",
              ["REQUIRE_FINAL_SCORE", "ALLOW"],
            ],
            ["upcomingEventPolicy", "Upcoming Event", ["ALLOW", "BLOCK"]],
            ["developmentStoryPolicy", "Development Story", ["ALLOW", "BLOCK"]],
          ].map(([key, label, options]) => (
            <label key={key as string}>
              {label as string}
              <select
                value={s[key as keyof Settings] as string}
                onChange={(e) =>
                  patch(key as keyof Settings, e.target.value as never)
                }
              >
                {(options as string[]).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className={styles.panel}>
          <h3>Force Run</h3>

          <Toggle
            label="Force Run Enabled"
            checked={s.forceRunEnabled}
            onChange={(v) => patch("forceRunEnabled", v)}
          />

          <Toggle
            label="Allow Force Morning"
            checked={s.forceMorningEnabled}
            onChange={(v) => patch("forceMorningEnabled", v)}
          />

          <Toggle
            label="Allow Force Evening"
            checked={s.forceEveningEnabled}
            onChange={(v) => patch("forceEveningEnabled", v)}
          />
        </div>
      </div>
      <div className={styles.status}>
        <strong>Status</strong>
        <span>Last morning: {s.lastMorningRunAt ?? "Never"}</span>
        <span>Last evening: {s.lastEveningRunAt ?? "Never"}</span>
        <span>Last status: {s.lastRunStatus ?? "—"}</span>
        {s.lastError && <span>Error: {s.lastError}</span>}
      </div>
      {hasChanges && (
        <div className={styles.stickySaveBar}>
          <div className={styles.stickySaveInner}>
            <span>You have unsaved changes.</span>
            <div className={styles.stickySaveActions}>
              <button
                type="button"
                onClick={discardChanges}
                disabled={saving || Boolean(running)}
              >
                Discard
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || Boolean(running)}
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
