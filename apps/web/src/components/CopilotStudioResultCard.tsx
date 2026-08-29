"use client";

import styles from "./BrandCopilot.module.css";

export type CopilotStudioDraft = {
  facebook: string;
  telegram: string;
  instagram: string;
  reels: string;
  imagePrompt: string;
};

type StudioDraftTarget = keyof CopilotStudioDraft;

type Props = {
  draft: CopilotStudioDraft;
  editing: boolean;
  onToggleEdit: () => void;
  onChange: (target: StudioDraftTarget, value: string) => void;
  onRegenerate: () => void;
  onGenerateImage: () => void;
  onSchedule: () => void;
};

export function CopilotStudioResultCard({
  draft,
  editing,
  onToggleEdit,
  onChange,
  onRegenerate,
  onGenerateImage,
  onSchedule,
}: Props) {
  const hasResult = Boolean(
    draft.facebook.trim() ||
    draft.telegram.trim() ||
    draft.instagram.trim() ||
    draft.reels.trim() ||
    draft.imagePrompt.trim(),
  );

  if (!hasResult) {
    return null;
  }

  const outputs: Array<{
    key: StudioDraftTarget;
    label: string;
    content: string;
  }> = [
    {
      key: "facebook",
      label: "Facebook",
      content: draft.facebook,
    },
    {
      key: "telegram",
      label: "Telegram",
      content: draft.telegram,
    },
    {
      key: "instagram",
      label: "Instagram",
      content: draft.instagram,
    },
    {
      key: "reels",
      label: "Reels",
      content: draft.reels,
    },
    {
      key: "imagePrompt",
      label: "Image Prompt",
      content: draft.imagePrompt,
    },
  ];

  return (
    <section className={styles.copilotStudioResult}>
      {/* COPILOT_STUDIO_RESULT_CARD */}
      <div className={styles.copilotStudioResultHeader}>
        <div>
          <span>Studio Result</span>
          <strong>Generated with Elena</strong>
        </div>
      </div>

      {/* COPILOT_STUDIO_ACTION_BAR */}
      <div className={styles.copilotStudioResultActions}>
        <button type="button" onClick={onToggleEdit}>
          {editing ? "Done" : "Edit"}
        </button>

        <button type="button" onClick={onRegenerate}>
          Regenerate
        </button>

        <button type="button" onClick={onGenerateImage}>
          Generate Image
        </button>

        <button type="button" onClick={onSchedule}>
          Schedule
        </button>
      </div>

      {outputs.map(({ key, label, content }) =>
        content.trim() ? (
          <article key={key} className={styles.copilotStudioOutput}>
            <div>
              <strong>{label}</strong>

              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(content)}
              >
                Copy
              </button>
            </div>

            {editing ? (
              <textarea
                className={styles.copilotStudioEditor}
                value={content}
                onChange={(event) => onChange(key, event.target.value)}
                aria-label={`Edit ${label}`}
              />
            ) : (
              <p>{content}</p>
            )}
          </article>
        ) : null,
      )}
    </section>
  );
}
