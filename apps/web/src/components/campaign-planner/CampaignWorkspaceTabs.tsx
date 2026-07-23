import styles from "../CampaignPlanner.module.css";
import { CampaignWorkspaceTab } from "./campaign-planner.types";

export function CampaignWorkspaceTabs({
  activeTab,
  ideaCount,
  onChange,
}: {
  activeTab: CampaignWorkspaceTab;
  ideaCount: number;
  onChange: (tab: CampaignWorkspaceTab) => void;
}) {
  return (
    <nav className={styles.workspaceTabs}>
      <button
        type="button"
        className={
          activeTab === "overview"
            ? styles.activeWorkspaceTab
            : ""
        }
        onClick={() => onChange("overview")}
      >
        Overview
      </button>

      <button
        type="button"
        className={
          activeTab === "strategy"
            ? styles.activeWorkspaceTab
            : ""
        }
        onClick={() => onChange("strategy")}
      >
        Strategy
      </button>

      <button
        type="button"
        className={
          activeTab === "ideas"
            ? styles.activeWorkspaceTab
            : ""
        }
        onClick={() => onChange("ideas")}
      >
        Ideas
        <span>{ideaCount}</span>
      </button>

      <button
        type="button"
        className={
          activeTab === "assets"
            ? styles.activeWorkspaceTab
            : ""
        }
        onClick={() => onChange("assets")}
      >
        Assets
      </button>
    </nav>
  );
}
