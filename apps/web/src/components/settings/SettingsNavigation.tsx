"use client";

import { useState } from "react";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { AiRuntimeSettings } from "./AiRuntimeSettings";
import { PwaDiagnostics } from "@/components/PwaDiagnostics";
import { PwaControlCenter } from "@/components/PwaControlCenter";
import { PwaSettingsSection } from "@/components/PwaSettingsAccordion";
import { PwaAppSettings } from "@/components/PwaAppSettings";
import { PwaAppearanceSettings } from "@/components/PwaAppearanceSettings";
import { PwaStartupSettings } from "@/components/PwaStartupSettings";
import { PwaNavigationPresets } from "@/components/PwaNavigationPresets";
import styles from "./SettingsNavigation.module.css";

type SettingsTab = "general" | "ai-runtime" | "app-status";

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
  {
    id: "app-status",
    label: "App Status",
    description: "PWA mode, network and device diagnostics",
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
        ) : activeTab === "ai-runtime" ? (
          <AiRuntimeSettings />
        ) : (
          <div className="atlas-pwa-settings-stack">
            <PwaSettingsSection
              id="control"
              title="PWA Control Center"
              description="Global controls and reset options"
              defaultOpen
            >
              <PwaControlCenter />
            </PwaSettingsSection>

            <PwaSettingsSection
              id="presets"
              title="Navigation Presets"
              description="Switch Atlas dock layouts quickly"
            >
              <PwaNavigationPresets />
            </PwaSettingsSection>

            <PwaSettingsSection
              id="navigation"
              title="Navigation Customize"
              description="Choose shortcuts, order, labels and icons"
            >
              <PwaAppSettings />
            </PwaSettingsSection>

            <PwaSettingsSection
              id="appearance"
              title="App Appearance"
              description="Header, dock style and labels"
            >
              <PwaAppearanceSettings />
            </PwaSettingsSection>

            <PwaSettingsSection
              id="behaviour"
              title="App Behaviour"
              description="Startup page and last-page restore"
            >
              <PwaStartupSettings />
            </PwaSettingsSection>

            <PwaSettingsSection
              id="diagnostics"
              title="App Diagnostics"
              description="PWA mode, network and service-worker status"
            >
              <PwaDiagnostics />
            </PwaSettingsSection>
          </div>
        )}
      </div>
    </div>
  );
}
