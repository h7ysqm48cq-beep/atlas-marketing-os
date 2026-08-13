"use client";

import { useEffect } from "react";

import {
  PWA_CONTROL_CHANGE_EVENT,
  readPwaControlSettings,
} from "@/components/pwaControlConfig";

import {
  DEFAULT_PWA_APPEARANCE,
  PWA_APPEARANCE_CHANGE_EVENT,
  readPwaAppearanceSettings,
} from "@/components/pwaAppearanceConfig";

export function PwaAppearanceSync() {
  useEffect(() => {
    function apply() {
      const control = readPwaControlSettings();

      const settings = control.customizationsEnabled
        ? readPwaAppearanceSettings()
        : DEFAULT_PWA_APPEARANCE;

      const root = document.documentElement;

      root.dataset.pwaHeader = settings.showHeader ? "visible" : "hidden";

      root.dataset.pwaDockStyle = settings.dockStyle;

      root.dataset.pwaDockLabels = settings.showLabels ? "visible" : "hidden";
    }

    apply();

    window.addEventListener(PWA_APPEARANCE_CHANGE_EVENT, apply);

    window.addEventListener(PWA_CONTROL_CHANGE_EVENT, apply);

    window.addEventListener("storage", apply);

    return () => {
      window.removeEventListener(PWA_APPEARANCE_CHANGE_EVENT, apply);

      window.removeEventListener(PWA_CONTROL_CHANGE_EVENT, apply);

      window.removeEventListener("storage", apply);
    };
  }, []);

  return null;
}
