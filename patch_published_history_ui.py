from pathlib import Path
import shutil
import sys


TSX = Path(
    "apps/web/src/components/ContentHistory.tsx"
)

CSS = Path(
    "apps/web/src/components/ContentHistory.module.css"
)


def backup(path: Path, suffix: str) -> None:
    target = path.with_suffix(
        path.suffix + suffix
    )
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def patch_tsx() -> None:
    text = TSX.read_text(encoding="utf-8")
    original = text

    # 1. Keep selected record aligned with active filters.
    filtered_marker = '''  const filtered=useMemo(()=>records.filter((record)=>{
    const q=query.trim().toLowerCase();
    const search=!q || record.topic.toLowerCase().includes(q) || record.brand.name.toLowerCase().includes(q) || record.style.toLowerCase().includes(q);
    return search && (!onlyFavorites || record.isFavorite) && (statusFilter==="ALL" || record.status===statusFilter);
  }),[records,query,onlyFavorites,statusFilter]);
'''

    filtered_replacement = '''  const filtered=useMemo(()=>records.filter((record)=>{
    const q=query.trim().toLowerCase();
    const search=!q || record.topic.toLowerCase().includes(q) || record.brand.name.toLowerCase().includes(q) || record.style.toLowerCase().includes(q);
    return search && (!onlyFavorites || record.isFavorite) && (statusFilter==="ALL" || record.status===statusFilter);
  }),[records,query,onlyFavorites,statusFilter]);

  useEffect(()=>{
    if(!filtered.length){
      setSelected(null);
      return;
    }

    if(
      !selected ||
      !filtered.some((record)=>record.id===selected.id)
    ){
      setSelected(filtered[0]);
    }
  },[filtered,selected]);
'''

    if "filtered.some((record)=>record.id===selected.id)" not in text:
        if filtered_marker not in text:
            raise RuntimeError(
                "Could not find filtered records block."
            )

        text = text.replace(
            filtered_marker,
            filtered_replacement,
            1,
        )

    # 2. Published-aware AI Studio URL.
    old_studio_link = '''      <a href={buildStudioHref(selected)}>
        Continue in AI Studio
      </a>
'''

    new_studio_link = '''      <a
        href={
          selected.status === "PUBLISHED"
            ? `/ai-studio?${new URLSearchParams({
                topic: selected.topic,
                style: selected.style,
                language: selected.language,
              }).toString()}`
            : buildStudioHref(selected)
        }
      >
        {selected.status === "PUBLISHED"
          ? "Create new draft"
          : "Continue in AI Studio"}
      </a>
'''

    if old_studio_link in text:
        text = text.replace(
            old_studio_link,
            new_studio_link,
            1,
        )
    elif '"Create new draft"' not in text:
        raise RuntimeError(
            "Could not find AI Studio action link."
        )

    # 3. Hide delete for published records.
    old_delete = '''      <button
        className={styles.deleteButton}
        onClick={()=>void remove(selected)}
      >
        Delete
      </button>
'''

    new_delete = '''      {selected.status !== "PUBLISHED" ? (
        <button
          className={styles.deleteButton}
          onClick={()=>void remove(selected)}
        >
          Delete
        </button>
      ) : null}
'''

    if old_delete in text:
        text = text.replace(
            old_delete,
            new_delete,
            1,
        )
    elif 'selected.status !== "PUBLISHED"' not in text:
        raise RuntimeError(
            "Could not find delete button."
        )

    # 4. Replace workflow section.
    old_workflow = '''    <section className={styles.workflowPanel}><div className={styles.workflowTitle}><div><span>Approval workflow</span><strong>{formatStatus(selected.status)}</strong></div><small>{selected.reviewedBy?`Reviewer: ${selected.reviewedBy}`:"No reviewer assigned"}</small></div><div className={styles.reviewFields}><label><span>Reviewer</span><input value={reviewer} onChange={(e)=>setReviewer(e.target.value)}/></label><label><span>Review note</span><textarea value={reviewNote} onChange={(e)=>setReviewNote(e.target.value)} placeholder="Add feedback or approval notes..."/></label></div><div className={styles.workflowActions}><button disabled={saving} onClick={()=>void updateWorkflow("DRAFT")}>Draft</button><button disabled={saving} onClick={()=>void updateWorkflow("PENDING_REVIEW")}>Submit review</button><button disabled={saving} onClick={()=>void updateWorkflow("AI_IMPROVED")}>Need changes</button><button disabled={saving} className={styles.approveButton} onClick={()=>void updateWorkflow("APPROVED")}>Approve</button><button disabled={saving} className={styles.rejectButton} onClick={()=>void updateWorkflow("REJECTED")}>Reject</button><button disabled={saving||selected.status!=="APPROVED"} onClick={()=>void updateWorkflow("PUBLISHED")}>Mark published</button></div></section>
'''

    new_workflow = '''    {selected.status === "PUBLISHED" ? (
      <section className={`${styles.workflowPanel} ${styles.publishedPanel}`}>
        <div className={styles.workflowTitle}>
          <div>
            <span>Publishing details</span>
            <strong>Published</strong>
          </div>

          <small>
            {selected.reviewedBy
              ? `Published by: ${selected.reviewedBy}`
              : "Published by Atlas"}
          </small>
        </div>

        <div className={styles.publishedDetails}>
          <article>
            <span>Status</span>
            <strong>Published</strong>
          </article>

          <article>
            <span>Published at</span>
            <strong>
              {selected.publishedAt
                ? formatDate(selected.publishedAt)
                : "Published"}
            </strong>
          </article>

          <article>
            <span>Platforms</span>
            <strong>
              {selected.platforms
                .filter(
                  (platform) =>
                    platform === "Facebook" ||
                    platform === "Telegram",
                )
                .join(" · ") || "Not specified"}
            </strong>
          </article>
        </div>

        <div className={styles.reviewFields}>
          <label>
            <span>Published by</span>
            <input
              value={selected.reviewedBy || "Atlas Publisher"}
              readOnly
            />
          </label>

          <label>
            <span>Publishing note</span>
            <textarea
              value={
                selected.reviewNote ||
                "Successfully published through the Atlas automation workflow."
              }
              readOnly
            />
          </label>
        </div>

        <div className={styles.publishedActions}>
          <a href="/calendar">
            Open Content Calendar
          </a>

          <a
            href={`/ai-studio?${new URLSearchParams({
              topic: selected.topic,
              style: selected.style,
              language: selected.language,
            }).toString()}`}
          >
            Create new draft
          </a>
        </div>
      </section>
    ) : (
      <section className={styles.workflowPanel}>
        <div className={styles.workflowTitle}>
          <div>
            <span>Approval workflow</span>
            <strong>{formatStatus(selected.status)}</strong>
          </div>

          <small>
            {selected.reviewedBy
              ? `Reviewer: ${selected.reviewedBy}`
              : "No reviewer assigned"}
          </small>
        </div>

        <div className={styles.reviewFields}>
          <label>
            <span>Reviewer</span>
            <input
              value={reviewer}
              onChange={(e)=>setReviewer(e.target.value)}
            />
          </label>

          <label>
            <span>Review note</span>
            <textarea
              value={reviewNote}
              onChange={(e)=>setReviewNote(e.target.value)}
              placeholder="Add feedback or approval notes..."
            />
          </label>
        </div>

        <div className={styles.workflowActions}>
          <button
            disabled={saving}
            onClick={()=>void updateWorkflow("DRAFT")}
          >
            Draft
          </button>

          <button
            disabled={saving}
            onClick={()=>void updateWorkflow("PENDING_REVIEW")}
          >
            Submit review
          </button>

          <button
            disabled={saving}
            onClick={()=>void updateWorkflow("AI_IMPROVED")}
          >
            Need changes
          </button>

          <button
            disabled={saving}
            className={styles.approveButton}
            onClick={()=>void updateWorkflow("APPROVED")}
          >
            Approve
          </button>

          <button
            disabled={saving}
            className={styles.rejectButton}
            onClick={()=>void updateWorkflow("REJECTED")}
          >
            Reject
          </button>

          <button
            disabled={
              saving ||
              selected.status !== "APPROVED"
            }
            onClick={()=>void updateWorkflow("PUBLISHED")}
          >
            Mark published
          </button>
        </div>
      </section>
    )}
'''

    if old_workflow in text:
        text = text.replace(
            old_workflow,
            new_workflow,
            1,
        )
    elif "Publishing details" not in text:
        raise RuntimeError(
            "Could not find workflow panel block."
        )

    if text == original:
        print("ContentHistory.tsx already patched.")
        return

    backup(
        TSX,
        ".bak.published-readonly",
    )

    TSX.write_text(
        text,
        encoding="utf-8",
    )

    print("Updated ContentHistory.tsx")


def patch_css() -> None:
    text = CSS.read_text(encoding="utf-8")

    marker = "/* ===== Published Read-only UI ===== */"

    if marker in text:
        print(
            "ContentHistory.module.css already patched."
        )
        return

    css = r'''

/* ===== Published Read-only UI ===== */

.publishedPanel {
  border-color: rgba(77, 190, 134, 0.26);
  background:
    radial-gradient(
      circle at top right,
      rgba(77, 190, 134, 0.08),
      transparent 38%
    ),
    rgba(77, 190, 134, 0.035);
}

.publishedDetails {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.publishedDetails article {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(7, 9, 13, 0.38);
}

.publishedDetails span {
  color: var(--muted);
  font-size: 8px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.publishedDetails strong {
  color: #8fe0b5;
  font-size: 11px;
}

.publishedPanel .reviewFields input,
.publishedPanel .reviewFields textarea {
  cursor: default;
  opacity: 0.82;
}

.publishedActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.publishedActions a {
  display: grid;
  min-height: 36px;
  padding: 0 12px;
  place-items: center;
  border: 1px solid rgba(77, 190, 134, 0.28);
  border-radius: 9px;
  background: rgba(77, 190, 134, 0.07);
  color: #8fe0b5;
  font-size: 9px;
  font-weight: 800;
  text-decoration: none;
}

.publishedActions a:hover {
  background: rgba(77, 190, 134, 0.13);
}

@media (max-width: 760px) {
  .publishedDetails {
    grid-template-columns: 1fr;
  }
}
'''

    backup(
        CSS,
        ".bak.published-readonly",
    )

    CSS.write_text(
        text + css,
        encoding="utf-8",
    )

    print("Updated ContentHistory.module.css")


def main() -> None:
    for path in (TSX, CSS):
        if not path.exists():
            print(
                f"File not found: {path}",
                file=sys.stderr,
            )
            sys.exit(1)

    try:
        patch_tsx()
        patch_css()
    except Exception as error:
        print(
            f"Patch failed: {error}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("")
    print(
        "Published History read-only UI completed."
    )


if __name__ == "__main__":
    main()
