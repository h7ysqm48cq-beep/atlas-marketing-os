"use client";

import { AiStudioMobileShell } from "./AiStudioMobileShell";
import { BrandCopilot } from "./BrandCopilot";
import { ElenaActivityTimeline } from "./ElenaActivityTimeline";
import { ElenaUnifiedHistory } from "./ElenaUnifiedHistory";
import styles from "./AtlasAiWorkspace.module.css";
import { useAtlasWorkspace } from "./ai-workspace-context";

export function AtlasAiWorkspace() {
  const workspace = useAtlasWorkspace();

  const mobileTab = workspace.preferredMobileTab;

  const setMobileTab = workspace.setPreferredMobileTab;

  const studioVisible = mobileTab === "create" || mobileTab === "results";

  return (
    <section className={styles.workspace} data-mobile-tab={mobileTab}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Atlas AI</span>

          <h1>AI Workspace</h1>

          <p>Create, refine and continue with Elena in one workspace.</p>
        </div>
      </header>

      <div className={styles.layout}>
        <main
          className={styles.studioPanel}
          data-mobile-visible={studioVisible ? "true" : "false"}
          data-mobile-mode={mobileTab}
        >
          <AiStudioMobileShell />
        </main>

        <aside
          className={styles.elenaPanel}
          data-mobile-visible={mobileTab === "elena" ? "true" : "false"}
        >
          <BrandCopilot />

          <ElenaActivityTimeline />

          <ElenaUnifiedHistory />
        </aside>
      </div>

      <nav className={styles.mobileNav} aria-label="AI Workspace">
        <button
          type="button"
          className={mobileTab === "create" ? styles.activeTab : ""}
          onClick={() => setMobileTab("create")}
        >
          <span aria-hidden="true">✦</span>
          <span>Create</span>
        </button>

        <button
          type="button"
          className={mobileTab === "results" ? styles.activeTab : ""}
          onClick={() => setMobileTab("results")}
        >
          <span aria-hidden="true">▤</span>
          <span>Results</span>
        </button>

        <button
          type="button"
          className={mobileTab === "elena" ? styles.activeTab : ""}
          onClick={() => setMobileTab("elena")}
        >
          <span aria-hidden="true">◎</span>
          <span>Elena</span>
        </button>
      </nav>
    </section>
  );
}
