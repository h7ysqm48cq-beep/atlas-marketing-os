"use client";

import { useEffect } from "react";

export function AtlasThemeBootstrap() {
  useEffect(() => {
    try {
      const raw = localStorage.getItem("atlas.interface.preferences");

      const saved = raw ? JSON.parse(raw) : {};

      const language = saved.language === "zh" ? "zh" : "en";

      const preference = ["dark", "light", "system"].includes(saved.theme)
        ? saved.theme
        : "dark";

      const resolved =
        preference === "system"
          ? window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark"
          : preference;

      const root = document.documentElement;

      root.lang = language === "zh" ? "zh-CN" : "en";

      root.dataset.theme = resolved;
      root.dataset.themePreference = preference;
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  return null;
}
