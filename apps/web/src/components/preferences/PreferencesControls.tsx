"use client";

import { useState } from "react";
import { usePreferences } from "./PreferencesProvider";
import type { AtlasLanguage, AtlasTheme } from "./preferences.types";
import styles from "./PreferencesControls.module.css";

const themeOptions: Array<{
  value: AtlasTheme;
  icon: string;
}> = [
  { value: "dark", icon: "●" },
  { value: "light", icon: "○" },
  { value: "system", icon: "◐" },
];

export function PreferencesControls() {
  const { language, theme, resolvedTheme, setLanguage, setTheme, t } =
    usePreferences();

  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${t("interfaceLanguage")} / ${t("appearance")}`}
      >
        <span>{language === "zh" ? "中" : "EN"}</span>
        <i
          className={`${styles.themeGlyph} ${
            resolvedTheme === "dark" ? styles.moonGlyph : styles.sunGlyph
          }`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <>
          <button
            type="button"
            className={styles.backdrop}
            onClick={() => setOpen(false)}
            aria-label="Close"
          />

          <section className={styles.menu}>
            <div className={styles.section}>
              <span>{t("interfaceLanguage")}</span>

              <div className={styles.segmented}>
                {(
                  [
                    ["en", t("english")],
                    ["zh", t("chinese")],
                  ] as Array<[AtlasLanguage, string]>
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={language === value ? styles.active : ""}
                    onClick={() => setLanguage(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.section}>
              <span>{t("appearance")}</span>

              <div className={styles.themeList}>
                {themeOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={theme === option.value ? styles.activeTheme : ""}
                    onClick={() => setTheme(option.value)}
                  >
                    <i>{option.icon}</i>
                    <strong>{t(option.value)}</strong>
                    <span>{theme === option.value ? "✓" : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
