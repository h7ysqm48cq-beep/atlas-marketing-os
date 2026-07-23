"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApprovalState, ContentStatus } from "./AiWorkspace";
import styles from "./PlatformCard.module.css";

export type PlatformCardAction =
  | "copy"
  | "improve"
  | "rewrite"
  | "translate"
  | "shorter"
  | "longer";

type RewriteAction = Exclude<PlatformCardAction, "copy">;

type ContentVersion = {
  id: string;
  historyId: string;
  platform: string;
  content: string;
  sourceAction: string;
  versionNumber: number;
  createdAt: string;
};

type RewriteTone =
  | "Default"
  | "Funny"
  | "Professional"
  | "Malaysian Chinese"
  | "Emotional"
  | "Luxury"
  | "Gen Z";

type RewriteGoal =
  | "Balanced"
  | "More Viral"
  | "Better Hook"
  | "More Comments"
  | "More Shares"
  | "Stronger CTA";

type RewriteLength = "Auto" | "Short" | "Medium" | "Long";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const actionLabels: Record<PlatformCardAction, string> = {
  copy: "Copy",
  improve: "Improve",
  rewrite: "Rewrite",
  translate: "Translate",
  shorter: "Shorter",
  longer: "Longer",
};

const tones: RewriteTone[] = [
  "Default",
  "Funny",
  "Professional",
  "Malaysian Chinese",
  "Emotional",
  "Luxury",
  "Gen Z",
];

const goals: RewriteGoal[] = [
  "Balanced",
  "More Viral",
  "Better Hook",
  "More Comments",
  "More Shares",
  "Stronger CTA",
];

const lengths: RewriteLength[] = [
  "Auto",
  "Short",
  "Medium",
  "Long",
];

export function PlatformCard({
  title,
  description,
  content,
  score,
  campaignId,
  historyId,
  approval,
  onApprovalChange,
  copilotRequest,
  onReplace,
  onMessage,
}: {
  title: string;
  description: string;
  content: string;
  score?: number;
  campaignId?: string;
  historyId?: string;
  approval: ApprovalState;
  onApprovalChange: (approval: ApprovalState) => void;
  copilotRequest?: {
    platform: "Facebook" | "Telegram" | "Reels Script" | "Image Prompt";
    action: "improve" | "shorter" | "rewrite";
    nonce: number;
  } | null;
  onReplace: (content: string) => void;
  onMessage: (message: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [candidate, setCandidate] = useState("");
  const [pendingAction, setPendingAction] =
    useState<RewriteAction | null>(null);
  const [candidateAction, setCandidateAction] =
    useState<RewriteAction | null>(null);
  const [versions, setVersions] = useState<ContentVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [showRewritePanel, setShowRewritePanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState<RewriteTone>("Default");
  const [goal, setGoal] = useState<RewriteGoal>("Balanced");
  const [length, setLength] = useState<RewriteLength>("Auto");
  const [reviewNote, setReviewNote] = useState(approval.reviewNote || "");
  const [reviewer, setReviewer] = useState(approval.reviewedBy || "Loh");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);

  useEffect(() => {
    setReviewNote(approval.reviewNote || "");
    setReviewer(approval.reviewedBy || "Loh");
  }, [approval.reviewNote, approval.reviewedBy]);

  const hasGeneratedContent = useMemo(
    () => Boolean(content && !content.startsWith("Generate content")),
    [content],
  );

  useEffect(() => {
    if (historyId) void loadVersions();
  }, [historyId, title]);

  useEffect(() => {
    if (
      copilotRequest &&
      copilotRequest.platform === title &&
      copilotRequest.nonce
    ) {
      void runAction(copilotRequest.action);
    }
  }, [copilotRequest?.nonce]);

  async function loadVersions() {
    if (!historyId) return;

    const query = new URLSearchParams({
      historyId,
      platform: title,
    });

    const response = await fetch(
      `${API_BASE_URL}/versions?${query}`,
      { cache: "no-store" },
    );

    if (!response.ok) return;

    const data = (await response.json()) as ContentVersion[];
    if (Array.isArray(data)) setVersions(data);
  }

  async function saveVersion(
    nextContent: string,
    sourceAction: string,
  ) {
    if (!historyId) {
      onMessage(
        `${title} replaced locally. Generate content from AI Studio to enable persistent versions.`,
      );
      return;
    }

    const response = await fetch(`${API_BASE_URL}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        historyId,
        platform: title,
        content: nextContent,
        sourceAction,
      }),
    });

    if (!response.ok) {
      onMessage(`${title} replaced, but version saving failed.`);
      return;
    }

    await loadVersions();
  }

  async function copyContent() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    onMessage(`${title} copied.`);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function runAction(action: PlatformCardAction) {
    if (action === "copy") {
      await copyContent();
      return;
    }

    if (!hasGeneratedContent) {
      onMessage(`Generate ${title} content first.`);
      return;
    }

    setPendingAction(action);
    setCandidateAction(action);
    setCandidate("");
    onMessage(`${actionLabels[action]} is running for ${title}...`);

    try {
      const response = await fetch(`${API_BASE_URL}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          action,
          platform: title,
          campaignId: campaignId || undefined,
          targetLanguage:
            action === "translate" ? "English" : undefined,
          tone,
          goal,
          length,
        }),
      });

      const data = (await response.json()) as {
        content?: string;
        message?: string;
      };

      if (!response.ok || !data.content) {
        throw new Error(
          data.message || "Unable to rewrite content.",
        );
      }

      setCandidate(data.content);
      setShowRewritePanel(false);
      onMessage(`${title} candidate is ready.`);
    } catch (error) {
      setCandidateAction(null);
      onMessage(
        error instanceof Error
          ? error.message
          : "Unable to rewrite content.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function acceptCandidate() {
    if (!candidate) return;

    const acceptedAction = candidateAction || "rewrite";
    const configuration = `${tone}-${goal}-${length}`
      .toLowerCase()
      .replaceAll(" ", "-");

    onReplace(candidate);
    await saveVersion(
      candidate,
      `${acceptedAction}:${configuration}`,
    );

    setCandidate("");
    setCandidateAction(null);
    onMessage(
      `${title} replaced and saved as a new version.`,
    );
  }

  async function restoreVersion(version: ContentVersion) {
    onReplace(version.content);
    await saveVersion(
      version.content,
      `restore-v${version.versionNumber}`,
    );
    setShowVersions(false);
    onMessage(
      `${title} restored from V${version.versionNumber} and saved as a new version.`,
    );
  }


  async function updateApproval(status: ContentStatus) {
    if (!historyId) {
      onMessage("Generate and save content before changing approval status.");
      return;
    }

    setApprovalBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/history/${historyId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reviewNote: reviewNote.trim() || undefined,
          reviewedBy: reviewer.trim() || "Loh",
        }),
      });
      const data = (await response.json()) as ApprovalState & { message?: string };
      if (!response.ok || !data.status) {
        throw new Error(data.message || "Unable to update approval status.");
      }
      onApprovalChange(data);
      setApprovalOpen(false);
      onMessage(`${title} workflow updated to ${formatStatus(data.status)}.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update approval status.");
    } finally {
      setApprovalBusy(false);
    }
  }

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <div className={styles.titleRow}>
            <h3>{title}</h3>
            {typeof score === "number" ? (
              <span className={styles.score}>{score}/100</span>
            ) : null}
            {versions.length > 0 ? (
              <span className={styles.versionCount}>
                V{versions.length}
              </span>
            ) : null}
            <span className={`${styles.workflowBadge} ${styles[`status${approval.status}`]}`}>
              {statusIcon(approval.status)} {formatStatus(approval.status)}
            </span>
          </div>
          <p>{description}</p>
        </div>

        <div className={styles.headerActions}>
          <button type="button" onClick={() => setApprovalOpen((value) => !value)}>
            Review
          </button>
          <button
            type="button"
            onClick={() => setShowVersions(true)}
          >
            Versions
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </header>

      {approvalOpen ? (
        <div
          className={styles.approvalBackdrop}
          onClick={() => setApprovalOpen(false)}
        >
          <aside
            className={styles.approvalDrawer}
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.approvalDrawerHeader}>
              <div>
                <span>Approval workflow</span>
                <h3>{title}</h3>
              </div>

              <button
                type="button"
                onClick={() => setApprovalOpen(false)}
              >
                Close
              </button>
            </header>

            <div className={styles.workflowSummary}>
              <div>
                <span>Status</span>
                <strong
                  className={`${styles.workflowBadge} ${
                    styles[`status${approval.status}`]
                  }`}
                >
                  {statusIcon(approval.status)}{" "}
                  {formatStatus(approval.status)}
                </strong>
              </div>

              <div>
                <span>Reviewer</span>
                <strong>{approval.reviewedBy || reviewer || "Not assigned"}</strong>
              </div>

              <div>
                <span>Approved</span>
                <strong>
                  {approval.approvedAt
                    ? new Intl.DateTimeFormat("en-MY", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(approval.approvedAt))
                    : "Not approved"}
                </strong>
              </div>

              <div>
                <span>Published</span>
                <strong>
                  {approval.publishedAt
                    ? new Intl.DateTimeFormat("en-MY", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(approval.publishedAt))
                    : "Not published"}
                </strong>
              </div>
            </div>

            <section className={styles.workflowTimeline}>
              <span>Workflow timeline</span>

              <div>
                {workflowSteps.map((step) => {
                  const complete =
                    workflowRank(approval.status) >= workflowRank(step.status);

                  return (
                    <article
                      key={step.status}
                      className={complete ? styles.timelineComplete : ""}
                    >
                      <i>{complete ? "✓" : "○"}</i>
                      <div>
                        <strong>{step.label}</strong>
                        <p>{step.description}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className={styles.reviewFields}>
              <label>
                <span>Reviewer</span>
                <input
                  value={reviewer}
                  disabled={approval.status === "PUBLISHED"}
                  onChange={(event) => setReviewer(event.target.value)}
                  placeholder="Reviewer name"
                />
              </label>

              <label>
                <span>Review note</span>
                <textarea
                  value={reviewNote}
                  disabled={approval.status === "PUBLISHED"}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder="Add feedback, requested changes or approval notes..."
                />
              </label>
            </div>

            <div className={styles.approvalActions}>
              {approval.status === "DRAFT" ||
              approval.status === "AI_IMPROVED" ||
              approval.status === "REJECTED" ? (
                <button
                  disabled={approvalBusy}
                  onClick={() => void updateApproval("PENDING_REVIEW")}
                >
                  Submit for review
                </button>
              ) : null}

              {approval.status === "PENDING_REVIEW" ? (
                <>
                  <button
                    disabled={approvalBusy}
                    className={styles.approveButton}
                    onClick={() => void updateApproval("APPROVED")}
                  >
                    Approve
                  </button>

                  <button
                    disabled={approvalBusy}
                    onClick={() => void updateApproval("AI_IMPROVED")}
                  >
                    Need changes
                  </button>

                  <button
                    disabled={approvalBusy}
                    className={styles.rejectButton}
                    onClick={() => void updateApproval("REJECTED")}
                  >
                    Reject
                  </button>
                </>
              ) : null}

              {approval.status === "APPROVED" ? (
                <>
                  <button
                    disabled={approvalBusy}
                    className={styles.publishButton}
                    onClick={() => void updateApproval("PUBLISHED")}
                  >
                    Mark published
                  </button>

                  <button
                    disabled={approvalBusy}
                    onClick={() => void updateApproval("AI_IMPROVED")}
                  >
                    Reopen changes
                  </button>
                </>
              ) : null}

              {approval.status === "PUBLISHED" ? (
                <div className={styles.publishedNotice}>
                  ✓ Content published and workflow locked
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {!collapsed ? (
        <>
          <div className={styles.primaryToolbar}>
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => void runAction("copy")}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>

            <button
              type="button"
              className={styles.featuredAction}
              disabled={Boolean(pendingAction)}
              onClick={() => void runAction("improve")}
            >
              {pendingAction === "improve"
                ? "Improving..."
                : "Improve"}
            </button>

            <button
              type="button"
              className={styles.rewriteProButton}
              disabled={Boolean(pendingAction)}
              onClick={() =>
                setShowRewritePanel((value) => !value)
              }
            >
              Rewrite Pro {showRewritePanel ? "↑" : "↓"}
            </button>
          </div>

          {showRewritePanel ? (
            <section className={styles.rewritePanel}>
              <div className={styles.rewritePanelHeader}>
                <div>
                  <span>Rewrite configuration</span>
                  <strong>Shape the next candidate</strong>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRewritePanel(false)}
                >
                  Close
                </button>
              </div>

              <div className={styles.configurationGrid}>
                <label>
                  <span>Tone</span>
                  <select
                    value={tone}
                    onChange={(event) =>
                      setTone(event.target.value as RewriteTone)
                    }
                  >
                    {tones.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Goal</span>
                  <select
                    value={goal}
                    onChange={(event) =>
                      setGoal(event.target.value as RewriteGoal)
                    }
                  >
                    {goals.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Length</span>
                  <select
                    value={length}
                    onChange={(event) =>
                      setLength(
                        event.target.value as RewriteLength,
                      )
                    }
                  >
                    {lengths.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className={styles.activeConfiguration}>
                <span>{tone}</span>
                <span>{goal}</span>
                <span>{length}</span>
              </div>

              <button
                type="button"
                className={styles.generateRewriteButton}
                disabled={Boolean(pendingAction)}
                onClick={() => void runAction("rewrite")}
              >
                {pendingAction === "rewrite"
                  ? "Generating rewrite..."
                  : "✦ Generate configured rewrite"}
              </button>
            </section>
          ) : null}

          <div className={styles.contentBody}>
            <p>{content}</p>
          </div>

          <footer className={styles.secondaryToolbar}>
            <span>Quick adjustments</span>
            <div>
              {(
                [
                  "translate",
                  "shorter",
                  "longer",
                ] as RewriteAction[]
              ).map((action) => (
                <button
                  type="button"
                  key={action}
                  disabled={Boolean(pendingAction)}
                  onClick={() => void runAction(action)}
                >
                  {pendingAction === action
                    ? "Working..."
                    : actionLabels[action]}
                </button>
              ))}
            </div>
          </footer>

          {candidate ? (
            <section className={styles.compare}>
              <div className={styles.compareHeader}>
                <div>
                  <span>AI candidate</span>
                  <strong>
                    {candidateAction
                      ? `${actionLabels[candidateAction]} · ${tone} · ${goal} · ${length}`
                      : "Review before replacing"}
                  </strong>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => void acceptCandidate()}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCandidate("");
                      setCandidateAction(null);
                      onMessage(
                        `${title} candidate discarded.`,
                      );
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
              <p className={styles.candidateContent}>
                {candidate}
              </p>
            </section>
          ) : null}
        </>
      ) : null}

      {showVersions ? (
        <div
          className={styles.drawerBackdrop}
          onClick={() => setShowVersions(false)}
        >
          <aside
            className={styles.versionDrawer}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.versionHeader}>
              <div>
                <span>Version history</span>
                <strong>{title}</strong>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void loadVersions()}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setShowVersions(false)}
                >
                  Close
                </button>
              </div>
            </div>

            {versions.length === 0 ? (
              <p className={styles.emptyVersion}>
                No saved versions yet. Replace an AI candidate
                to create V1.
              </p>
            ) : (
              <div className={styles.versionList}>
                {versions.map((version) => (
                  <article key={version.id}>
                    <div className={styles.versionMeta}>
                      <strong>V{version.versionNumber}</strong>
                      <span>{version.sourceAction}</span>
                      <small>
                        {new Intl.DateTimeFormat("en-MY", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(
                          new Date(version.createdAt),
                        )}
                      </small>
                    </div>
                    <p>{version.content}</p>
                    <button
                      type="button"
                      onClick={() =>
                        void restoreVersion(version)
                      }
                    >
                      Restore this version
                    </button>
                  </article>
                ))}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </article>
  );
}


const workflowSteps: Array<{
  status: ContentStatus;
  label: string;
  description: string;
}> = [
  {
    status: "DRAFT",
    label: "Draft",
    description: "Content is being prepared.",
  },
  {
    status: "PENDING_REVIEW",
    label: "Pending review",
    description: "Waiting for reviewer approval.",
  },
  {
    status: "APPROVED",
    label: "Approved",
    description: "Ready for publishing.",
  },
  {
    status: "PUBLISHED",
    label: "Published",
    description: "Content has been published.",
  },
];

function workflowRank(status: ContentStatus) {
  const rank: Record<ContentStatus, number> = {
    DRAFT: 0,
    AI_IMPROVED: 0,
    REJECTED: 0,
    PENDING_REVIEW: 1,
    APPROVED: 2,
    PUBLISHED: 3,
  };

  return rank[status];
}

function statusIcon(status: ContentStatus) {
  const icons: Record<ContentStatus, string> = {
    DRAFT: "●",
    AI_IMPROVED: "✦",
    PENDING_REVIEW: "●",
    APPROVED: "✓",
    REJECTED: "×",
    PUBLISHED: "◆",
  };

  return icons[status];
}

function formatStatus(status: ContentStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
