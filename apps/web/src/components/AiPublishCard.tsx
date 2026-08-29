"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceResult } from "./AiWorkspace";
import { RuntimeImage } from "./RuntimeImage";
import styles from "./AiPublishCard.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";
type Platform = "FACEBOOK" | "TELEGRAM" | "INSTAGRAM";

type PublishAsset = {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string | null;
  collection: string | null;
  remark: string | null;
  aiEnabled: boolean;
};

type PublishResult = {
  success: boolean;
  count: number;
  posts: Array<{
    id: string;
    platform: Platform;
    status: string;
    scheduledAt: string;
    channel: {
      id: string;
      name: string;
    };
  }>;
};

type Props = {
  result: WorkspaceResult;
  campaignId?: string;
  topic: string;
  onMessage?: (message: string) => void;
  onResultChange: (result: WorkspaceResult) => void;
};

function defaultDateTime() {
  const date = new Date(Date.now() + 5 * 60 * 1000);

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return local.toISOString().slice(0, 16);
}

function platformLabel(platform: Platform) {
  return platform === "FACEBOOK"
    ? "Facebook"
    : platform === "TELEGRAM"
      ? "Telegram"
      : "Instagram";
}

export function AiPublishCard({
  result,
  campaignId,
  topic,
  onMessage,
  onResultChange,
}: Props) {
  const { t } = usePreferences();
  const [brandId, setBrandId] = useState("");
  const [facebook, setFacebook] = useState(true);
  const [telegram, setTelegram] = useState(true);
  const [instagram, setInstagram] = useState(Boolean(result.instagram?.trim()));
  const [mode, setMode] = useState<"NOW" | "SCHEDULE">("SCHEDULE");
  const [scheduledAt, setScheduledAt] = useState(defaultDateTime);
  const [publishing, setPublishing] = useState(false);
  const [availableAssets, setAvailableAssets] = useState<PublishAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<PublishAsset | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [error, setError] = useState("");
  const [publishResult, setPublishResult] = useState<PublishResult | null>(
    null,
  );

  const [originalFacebook, setOriginalFacebook] = useState(result.facebook);
  const [originalTelegram, setOriginalTelegram] = useState(result.telegram);
  const [originalInstagram, setOriginalInstagram] = useState(result.instagram ?? "");
  const [savedFacebook, setSavedFacebook] = useState(result.facebook);
  const [savedTelegram, setSavedTelegram] = useState(result.telegram);
  const [savedInstagram, setSavedInstagram] = useState(result.instagram ?? "");
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset editor snapshots when a different generated result is selected.
    setOriginalFacebook(result.facebook);
    setOriginalTelegram(result.telegram);
    setOriginalInstagram(result.instagram ?? "");
    setSavedFacebook(result.facebook);
    setSavedTelegram(result.telegram);
    setSavedInstagram(result.instagram ?? "");
  }, [result.historyId, result.facebook, result.telegram, result.instagram]);

  useEffect(() => {
    let cancelled = false;

    async function loadBrand() {
      try {
        const response = await fetch(`${API_URL}/brands`, {
          cache: "no-store",
        });

        const brands = (await response.json()) as Array<{
          id: string;
          status?: string;
        }>;

        const brand =
          brands.find((item) => item.status === "ACTIVE") ?? brands[0];

        if (!cancelled && brand) {
          setBrandId(brand.id);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load brand.");
        }
      }
    }

    void loadBrand();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPlatforms = useMemo(() => {
    const platforms: Platform[] = [];

    if (facebook) platforms.push("FACEBOOK");
    if (telegram) platforms.push("TELEGRAM");
    if (instagram) platforms.push("INSTAGRAM");

    return platforms;
  }, [facebook, telegram, instagram]);

  const confidence = Math.round(
    (result.analysis.brandFitScore +
      result.analysis.discussionScore +
      result.analysis.shareabilityScore) /
      3,
  );

  const facebookEdited = result.facebook !== originalFacebook;

  const telegramEdited = result.telegram !== originalTelegram;
  const instagramEdited = (result.instagram ?? "") !== originalInstagram;

  const hasUnsavedDraft =
    result.facebook !== savedFacebook || result.telegram !== savedTelegram ||
    (result.instagram ?? "") !== savedInstagram;

  function updateFacebookDraft(content: string) {
    onResultChange({
      ...result,
      facebook: content,
    });
  }

  function updateTelegramDraft(content: string) {
    onResultChange({
      ...result,
      telegram: content,
    });
  }

  function updateInstagramDraft(content: string) {
    onResultChange({ ...result, instagram: content });
  }

  function resetDraft() {
    onResultChange({
      ...result,
      facebook: originalFacebook,
      telegram: originalTelegram,
      instagram: originalInstagram,
    });

    setSavedFacebook(originalFacebook);
    setSavedTelegram(originalTelegram);
    setSavedInstagram(originalInstagram);
    setError("");
    onMessage?.("Draft reset to the original AI version.");
  }

  async function saveDraft() {
    setError("");

    if (!result.historyId) {
      setError(
        "This workspace has no history record. Generate the content again before saving.",
      );
      return;
    }

    if (!result.facebook.trim() && !result.telegram.trim() && !(result.instagram ?? "").trim()) {
      setError("Draft content cannot be empty.");
      return;
    }

    setSavingDraft(true);
    onMessage?.("Saving edited draft versions...");

    try {
      const versions: Array<{
        platform: "Facebook" | "Telegram" | "Instagram";
        content: string;
      }> = [];

      if (result.facebook !== savedFacebook) {
        versions.push({
          platform: "Facebook",
          content: result.facebook,
        });
      }

      if (result.telegram !== savedTelegram) {
        versions.push({
          platform: "Telegram",
          content: result.telegram,
        });
      }

      if ((result.instagram ?? "") !== savedInstagram) {
        versions.push({
          platform: "Instagram",
          content: result.instagram ?? "",
        });
      }

      if (!versions.length) {
        onMessage?.("Draft is already saved.");
        return;
      }

      const responses = await Promise.all(
        versions.map((version) =>
          fetch(`${API_URL}/versions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              historyId: result.historyId,
              platform: version.platform,
              content: version.content,
              sourceAction: "manual-draft-edit",
            }),
          }),
        ),
      );

      const failed = responses.find((response) => !response.ok);

      if (failed) {
        const data = (await failed.json()) as {
          message?: string;
        };

        throw new Error(data.message || "Unable to save draft version.");
      }

      setSavedFacebook(result.facebook);
      setSavedTelegram(result.telegram);
      setSavedInstagram(result.instagram ?? "");

      onMessage?.(
        `${versions.length} edited draft version${
          versions.length === 1 ? "" : "s"
        } saved.`,
      );
    } catch (draftError) {
      const message =
        draftError instanceof Error
          ? draftError.message
          : "Unable to save draft.";

      setError(message);
      onMessage?.(message);
    } finally {
      setSavingDraft(false);
    }
  }

  function resetPublish() {
    setPublishResult(null);
    setError("");
    setScheduledAt(defaultDateTime());
  }

  async function openAssetPicker() {
    setAssetPickerOpen(true);

    if (availableAssets.length) {
      return;
    }

    setLoadingAssets(true);

    try {
      const response = await fetch(`${API_URL}/assets?type=IMAGE`, {
        cache: "no-store",
      });

      const data = (await response.json()) as
        | PublishAsset[]
        | {
            message?: string;
          };

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          !Array.isArray(data) && data.message
            ? data.message
            : "Unable to load Asset Library.",
        );
      }

      setAvailableAssets(data.filter((asset) => asset.aiEnabled));
    } catch (assetError) {
      setError(
        assetError instanceof Error
          ? assetError.message
          : "Unable to load Asset Library.",
      );
    } finally {
      setLoadingAssets(false);
    }
  }

  async function publish() {
    setError("");

    if (!brandId) {
      setError("Brand is not ready.");
      return;
    }

    if (!selectedPlatforms.length) {
      setError("Select at least one platform.");
      return;
    }

    if (facebook && !result.facebook.trim()) {
      setError("Facebook draft cannot be empty.");
      return;
    }

    if (telegram && !result.telegram.trim()) {
      setError("Telegram draft cannot be empty.");
      return;
    }

    if (instagram && !(result.instagram ?? "").trim()) {
      setError("Instagram draft cannot be empty.");
      return;
    }

    if (instagram && !selectedAsset) {
      setError("Select an image asset for Instagram publishing.");
      return;
    }

    if (hasUnsavedDraft) {
      setError("Save the edited draft before publishing or scheduling.");
      return;
    }

    if (mode === "SCHEDULE" && Number.isNaN(new Date(scheduledAt).getTime())) {
      setError("Choose a valid schedule time.");
      return;
    }

    const finalScheduledAt =
      mode === "NOW"
        ? new Date().toISOString()
        : new Date(scheduledAt).toISOString();

    const contents: Partial<Record<Platform, string>> = {};
    const mediaUrls: Partial<Record<Platform, string[]>> = {};

    if (selectedAsset) {
      if (facebook) {
        mediaUrls.FACEBOOK = [selectedAsset.url];
      }

      if (telegram) {
        mediaUrls.TELEGRAM = [selectedAsset.url];
      }

      if (instagram) {
        mediaUrls.INSTAGRAM = [selectedAsset.url];
      }
    }

    if (facebook) {
      contents.FACEBOOK = result.facebook;
    }

    if (telegram) {
      contents.TELEGRAM = result.telegram;
    }

    if (instagram) {
      contents.INSTAGRAM = result.instagram ?? "";
    }

    setPublishing(true);
    onMessage?.("Creating multi-platform scheduled posts...");

    try {
      const response = await fetch(`${API_URL}/automation/multi-publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          brandId,
          campaignId: campaignId || undefined,
          historyId: result.historyId || undefined,
          title: topic.trim() || "AI Studio Content",
          contents,
          mediaUrls,
          platforms: selectedPlatforms,
          scheduledAt: finalScheduledAt,
          timezone: "Asia/Kuala_Lumpur",
          queueImmediately: true,
        }),
      });

      const data = (await response.json()) as
        PublishResult | { message?: string };

      if (!response.ok || !("posts" in data)) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to schedule content.",
        );
      }

      setPublishResult(data);
      onMessage?.(`${data.count} platform post(s) successfully queued.`);
    } catch (publishError) {
      const message =
        publishError instanceof Error
          ? publishError.message
          : "Unable to publish content.";

      setError(message);
      onMessage?.(message);
    } finally {
      setPublishing(false);
    }
  }

  if (publishResult) {
    return (
      <section className={styles.card}>
        <div className={styles.successHero}>
          <span className={styles.successIcon}>✓</span>

          <div>
            <p>Publishing workflow completed</p>
            <h3>Content successfully queued</h3>
            <span>Atlas will publish each post at the selected time.</span>
          </div>
        </div>

        <div className={styles.resultList}>
          {publishResult.posts.map((post) => (
            <article key={post.id}>
              <div className={styles.platformIcon}>
                {post.platform === "FACEBOOK" ? "f" : post.platform === "TELEGRAM" ? "✈" : "◎"}
              </div>

              <div>
                <strong>{platformLabel(post.platform)}</strong>
                <span>{post.channel.name}</span>
              </div>

              <span className={styles.queuedStatus}>{post.status}</span>
            </article>
          ))}
        </div>

        <div className={styles.successActions}>
          <a className={styles.calendarButton} href="/calendar">
            Open Content Calendar
          </a>

          <button type="button" onClick={resetPublish}>
            Publish another
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.heading}>
        <div>
          <p>Final publishing step</p>
          <h3>Ready to publish?</h3>
          <span>Review the selected platforms and schedule.</span>
        </div>

        <span className={styles.ready}>Ready</span>
      </div>

      <div className={styles.scoreGrid}>
        <article>
          <span>AI confidence</span>
          <strong>{confidence}%</strong>
        </article>

        <article>
          <span>Brand fit</span>
          <strong>{result.analysis.brandFitScore}%</strong>
        </article>

        <article>
          <span>Discussion</span>
          <strong>{result.analysis.discussionScore}%</strong>
        </article>
      </div>

      <div className={styles.section}>
        <div className={styles.draftEditorHeading}>
          <div>
            <span className={styles.sectionLabel}>{t("finalPostEditor")}</span>

            <small>{t("finalPostEditorDescription")}</small>
          </div>

          <span
            className={
              hasUnsavedDraft ? styles.unsavedStatus : styles.savedStatus
            }
          >
            {hasUnsavedDraft
              ? t("unsavedChanges")
              : facebookEdited || telegramEdited || instagramEdited
                ? t("editedDraftSaved")
                : t("aiDraftSaved")}
          </span>
        </div>

        <div className={styles.draftEditorGrid}>
          <label className={styles.draftField}>
            <div>
              <strong>{t("facebookPost")}</strong>
              <span>
                {result.facebook.length.toLocaleString()} {t("characters")}
              </span>
            </div>

            <textarea
              value={result.facebook}
              onChange={(event) => updateFacebookDraft(event.target.value)}
              placeholder={`${t("facebookPost")}...`}
            />
          </label>

          <label className={styles.draftField}>
            <div>
              <strong>Instagram post</strong>
              <span>
                {(result.instagram ?? "").length.toLocaleString()} {t("characters")}
              </span>
            </div>
            <textarea
              value={result.instagram ?? ""}
              onChange={(event) => updateInstagramDraft(event.target.value)}
              placeholder="Instagram post..."
            />
          </label>

          <label className={styles.draftField}>
            <div>
              <strong>{t("telegramPost")}</strong>
              <span>
                {result.telegram.length.toLocaleString()} {t("characters")}
              </span>
            </div>

            <textarea
              value={result.telegram}
              onChange={(event) => updateTelegramDraft(event.target.value)}
              placeholder={`${t("telegramPost")}...`}
            />
          </label>
        </div>

        <div className={styles.draftActions}>
          <div>
            <span>Facebook: {facebookEdited ? "Edited" : "Original"}</span>

            <span>Telegram: {telegramEdited ? "Edited" : "Original"}</span>
            <span>Instagram: {instagramEdited ? "Edited" : "Original"}</span>
          </div>

          <div>
            <button
              type="button"
              onClick={resetDraft}
              disabled={savingDraft || (!facebookEdited && !telegramEdited && !instagramEdited)}
            >
              {t("resetAiVersion")}
            </button>

            <button
              type="button"
              className={styles.saveDraftButton}
              onClick={() => void saveDraft()}
              disabled={savingDraft || !hasUnsavedDraft}
            >
              {savingDraft ? "Saving draft..." : t("saveEditedDraft")}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t("publishChannels")}</span>

        <div className={styles.platforms}>
          <label>
            <input
              type="checkbox"
              checked={facebook}
              onChange={(event) => setFacebook(event.target.checked)}
            />

            <span className={styles.platformIcon}>f</span>

            <span>
              <strong>Facebook</strong>
              <small>Shiba MGM House</small>
            </span>
          </label>

          <label>
            <input
              type="checkbox"
              checked={instagram}
              onChange={(event) => setInstagram(event.target.checked)}
            />
            <span className={styles.platformIcon}>◎</span>
            <span>
              <strong>Instagram</strong>
              <small>Instagram Business</small>
            </span>
          </label>

          <label>
            <input
              type="checkbox"
              checked={telegram}
              onChange={(event) => setTelegram(event.target.checked)}
            />

            <span className={styles.platformIcon}>✈</span>

            <span>
              <strong>Telegram</strong>
              <small>MGMBET MYR</small>
            </span>
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.assetHeading}>
          <span className={styles.sectionLabel}>{t("attachedImage")}</span>

          <button type="button" onClick={() => void openAssetPicker()}>
            + Choose from Asset Library
          </button>
        </div>

        {selectedAsset ? (
          <div className={styles.selectedAsset}>
            <RuntimeImage
              src={selectedAsset.thumbnailUrl || selectedAsset.url}
              alt={selectedAsset.name}
            />

            <div>
              <strong>{selectedAsset.name}</strong>
              <small>{selectedAsset.collection || "No collection"}</small>
              <p>{selectedAsset.remark || "No AI remark saved."}</p>
            </div>

            <button
              type="button"
              onClick={() => setSelectedAsset(null)}
              aria-label={`Remove ${selectedAsset.name}`}
            >
              ×
            </button>
          </div>
        ) : (
          <p className={styles.noAsset}>
            No image attached. The post will be published as text only.
          </p>
        )}
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t("publishingTime")}</span>

        <div className={styles.mode}>
          <label className={mode === "NOW" ? styles.activeMode : ""}>
            <input
              type="radio"
              name="publish-mode"
              checked={mode === "NOW"}
              onChange={() => setMode("NOW")}
            />

            <span>
              <strong>{t("publishImmediately")}</strong>
              <small>Send to the queue now</small>
            </span>
          </label>

          <label className={mode === "SCHEDULE" ? styles.activeMode : ""}>
            <input
              type="radio"
              name="publish-mode"
              checked={mode === "SCHEDULE"}
              onChange={() => setMode("SCHEDULE")}
            />

            <span>
              <strong>Schedule</strong>
              <small>Choose a future time</small>
            </span>
          </label>
        </div>

        {mode === "SCHEDULE" ? (
          <label className={styles.scheduleField}>
            <span>Publish date and time</span>

            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <button
        type="button"
        className={styles.publishButton}
        disabled={
          publishing ||
          savingDraft ||
          hasUnsavedDraft ||
          !brandId ||
          selectedPlatforms.length === 0
        }
        onClick={() => void publish()}
      >
        <span>↗</span>

        {publishing
          ? "Scheduling content..."
          : hasUnsavedDraft
            ? t("saveDraftBeforePublishing")
            : mode === "NOW"
              ? `Publish to ${selectedPlatforms.length} platform${
                  selectedPlatforms.length === 1 ? "" : "s"
                }`
              : `Schedule ${selectedPlatforms.length} platform${
                  selectedPlatforms.length === 1 ? "" : "s"
                }`}
      </button>
      {assetPickerOpen ? (
        <div
          className={styles.assetModalBackdrop}
          onMouseDown={() => setAssetPickerOpen(false)}
        >
          <div
            className={styles.assetModal}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.assetModalHeader}>
              <div>
                <p>Asset Library</p>
                <h3>Choose publishing image</h3>
              </div>

              <button
                type="button"
                onClick={() => setAssetPickerOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <input
              className={styles.assetSearch}
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              placeholder="Search name, collection or remark..."
            />

            {loadingAssets ? (
              <p className={styles.assetMessage}>Loading Asset Library...</p>
            ) : (
              <div className={styles.assetGrid}>
                {availableAssets
                  .filter((asset) => {
                    const query = assetSearch.trim().toLowerCase();

                    if (!query) return true;

                    return [
                      asset.name,
                      asset.collection || "",
                      asset.remark || "",
                    ].some((value) => value.toLowerCase().includes(query));
                  })
                  .map((asset) => (
                    <button
                      className={
                        selectedAsset?.id === asset.id
                          ? styles.assetCardSelected
                          : styles.assetCard
                      }
                      type="button"
                      key={asset.id}
                      onClick={() => {
                        setSelectedAsset(asset);
                        setAssetPickerOpen(false);
                      }}
                    >
                      <RuntimeImage
                        src={asset.thumbnailUrl || asset.url}
                        alt={asset.name}
                      />

                      <div>
                        <strong>{asset.name}</strong>
                        <small>{asset.collection || "No collection"}</small>
                        <p>{asset.remark || "No AI remark saved."}</p>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
