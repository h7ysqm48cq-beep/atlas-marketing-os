"use client";

import { useState } from "react";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { AiRuntimeSettings } from "./AiRuntimeSettings";
import styles from "./SettingsNavigation.module.css";

type SettingsTab = "general" | "ai-runtime";

const tabs: Array<{
  id: SettingsTab;
  label: string;
  description: string;
}> = [
  {
    id: "general",
    label: "General Settings",
    description: "Workspace, publishing and connected channels",
  },
  {
    id: "ai-runtime",
    label: "AI Runtime",
    description: "Models used across Atlas AI services",
  },
];

export function SettingsNavigation() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div className={styles.page}>
      <nav className={styles.navigation} aria-label="Settings navigation">
        <div className={styles.tabs}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                className={`${styles.tab} ${active ? styles.activeTab : ""}`}
                onClick={() => setActiveTab(tab.id)}
                aria-selected={active}
                role="tab"
              >
                <span className={styles.tabLabel}>{tab.label}</span>

                <span className={styles.tabDescription}>{tab.description}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className={styles.content} role="tabpanel">
        {activeTab === "general" ? (
          <WorkspaceSettings />
        ) : (
          <AiRuntimeSettings />
        )}
      </div>
    </div>
  );
}
