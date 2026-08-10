import { AutomationDashboard } from "@/components/automation/AutomationDashboard";
import { SportsNewsSettings } from "@/components/automation/SportsNewsSettings";
import { AppLayout } from "@/components/AppLayout";

import styles from "./AutomationPage.module.css";

export default function AutomationPage() {
  return (
    <AppLayout>
      <div className={styles.page}>
        <nav className={styles.nav} aria-label="Automation sections">
          <a href="#automation-overview">Overview</a>

          <a href="#connected-platforms">Platforms</a>

          <a href="#publishing">Publishing</a>

          <a href="#browser-tools">Browser</a>

          <a href="#sports-news">Sports News</a>
        </nav>

        <div id="automation-overview" className={styles.section}>
          <AutomationDashboard />
        </div>

        <div
          id="sports-news"
          className={styles.section}
          style={{ marginTop: 24 }}
        >
          <SportsNewsSettings />
        </div>
      </div>
    </AppLayout>
  );
}
