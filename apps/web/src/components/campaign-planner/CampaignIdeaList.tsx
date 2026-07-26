import styles from "../CampaignPlanner.module.css";
import { CampaignIdea } from "./campaign-planner.types";

export function CampaignIdeaList({
  ideas,
  onRefresh,
  onOpen,
  onDelete,
}: {
  ideas: CampaignIdea[];
  onRefresh: () => void;
  onOpen: (idea: CampaignIdea) => void;
  onDelete: (idea: CampaignIdea) => void;
}) {
  return (
    <section className={styles.ideaArea}>
      <div className={styles.ideaHeading}>
        <div>
          <p className={styles.eyebrow}>Content roadmap</p>
          <h2>{ideas.length} planned ideas</h2>
        </div>

        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {ideas.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>No campaign ideas yet</strong>
          <span>
            Complete the brief and generate your first roadmap.
          </span>
        </div>
      ) : (
        <div className={styles.ideaGrid}>
          {ideas.map((idea) => (
            <article className={styles.ideaCard} key={idea.id}>
              <div className={styles.ideaTop}>
                <span>
                  #{String(idea.sortOrder).padStart(2, "0")}
                </span>
                <small>{idea.platform}</small>
              </div>

              <h3>{idea.title}</h3>

              <div className={styles.ideaBlock}>
                <span>Angle</span>
                <p>{idea.angle}</p>
              </div>

              <div className={styles.ideaBlock}>
                <span>Opening hook</span>
                <p>{idea.hook}</p>
              </div>

              <div className={styles.tags}>
                <span>{idea.style}</span>
                <span>{idea.language}</span>
                <span>{idea.status}</span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={() => onOpen(idea)}
                >
                  Open in AI Studio
                </button>

                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => onDelete(idea)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
