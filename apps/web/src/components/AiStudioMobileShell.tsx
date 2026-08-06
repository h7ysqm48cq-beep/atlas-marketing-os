"use client";

import { useEffect, useState } from "react";
import { AiStudio } from "./AiStudio";
import styles from "./AiStudioMobileShell.module.css";

export function AiStudioMobileShell() {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    const collapseCopilot = () => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      );
      const collapseButton = buttons.find(
        (button) => button.textContent?.trim() === "Collapse",
      );

      collapseButton?.click();
    };

    const frame = window.requestAnimationFrame(collapseCopilot);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      className={styles.shell}
      data-advanced-open={advancedOpen ? "true" : "false"}
    >
      <header className={styles.mobileHeader}>
        <div>
          <span>AI Studio</span>
          <strong>Create content</strong>
        </div>

        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          {advancedOpen ? "Hide settings" : "Advanced"}
          <span aria-hidden="true">{advancedOpen ? "⌃" : "⌄"}</span>
        </button>
      </header>

      <AiStudio />
    </section>
  );
}
