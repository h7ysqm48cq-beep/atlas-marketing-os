"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translate, type TranslationKey } from "./translations";
import type {
  AtlasLanguage,
  AtlasResolvedTheme,
  AtlasTheme,
} from "./preferences.types";

type PreferencesContextValue = {
  language: AtlasLanguage;
  theme: AtlasTheme;
  resolvedTheme: AtlasResolvedTheme;
  setLanguage: (language: AtlasLanguage) => void;
  setTheme: (theme: AtlasTheme) => void;
  t: (key: TranslationKey) => string;
};

const STORAGE_KEY = "atlas.interface.preferences";
const COOKIE_KEY = "atlas_interface_preferences";

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function systemTheme(): AtlasResolvedTheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }

  return "dark";
}

function resolveTheme(theme: AtlasTheme): AtlasResolvedTheme {
  return theme === "system" ? systemTheme() : theme;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AtlasLanguage>("en");
  const [theme, setThemeState] = useState<AtlasTheme>("dark");
  const [resolvedTheme, setResolvedTheme] =
    useState<AtlasResolvedTheme>("dark");

  const applyPreferences = useCallback(
    (nextLanguage: AtlasLanguage, nextTheme: AtlasTheme) => {
      const nextResolvedTheme = resolveTheme(nextTheme);

      setLanguageState(nextLanguage);
      setThemeState(nextTheme);
      setResolvedTheme(nextResolvedTheme);

      document.documentElement.lang = nextLanguage === "zh" ? "zh-CN" : "en";

      document.documentElement.dataset.theme = nextResolvedTheme;

      document.documentElement.dataset.themePreference = nextTheme;
    },
    [],
  );

  useEffect(() => {
    let nextLanguage: AtlasLanguage = "en";
    let nextTheme: AtlasTheme = "dark";

    const localStored =
      window.localStorage.getItem(STORAGE_KEY);

    const cookieStored =
      document.cookie
        .split("; ")
        .find((item) =>
          item.startsWith(`${COOKIE_KEY}=`)
        )
        ?.split("=")
        .slice(1)
        .join("=");

    const stored =
      localStored ||
      (
        cookieStored
          ? decodeURIComponent(cookieStored)
          : null
      );

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as {
          language?: AtlasLanguage;
          theme?: AtlasTheme;
        };

        if (parsed.language === "en" || parsed.language === "zh") {
          nextLanguage = parsed.language;
        }

        if (
          parsed.theme === "dark" ||
          parsed.theme === "light" ||
          parsed.theme === "system"
        ) {
          nextTheme = parsed.theme;
        }
      } catch {
        // Ignore invalid stored preferences.
      }
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate client preferences from localStorage and apply them to the document.
    applyPreferences(nextLanguage, nextTheme);
  }, [applyPreferences]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");

    function handleSystemThemeChange() {
      if (theme === "system") {
        applyPreferences(language, "system");
      }
    }

    media.addEventListener("change", handleSystemThemeChange);

    return () => {
      media.removeEventListener("change", handleSystemThemeChange);
    };
  }, [applyPreferences, language, theme]);

  function persist(nextLanguage: AtlasLanguage, nextTheme: AtlasTheme) {
    const serialized = JSON.stringify({
      language: nextLanguage,
      theme: nextTheme,
    });

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        serialized,
      );
    } catch {
      // Storage may be restricted in private browsing.
    }

    document.cookie = [
      `${COOKIE_KEY}=${encodeURIComponent(serialized)}`,
      "path=/",
      "max-age=31536000",
      "samesite=lax",
      window.location.protocol === "https:"
        ? "secure"
        : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  function setLanguage(nextLanguage: AtlasLanguage) {
    applyPreferences(nextLanguage, theme);
    persist(nextLanguage, theme);
  }

  function setTheme(nextTheme: AtlasTheme) {
    applyPreferences(language, nextTheme);
    persist(language, nextTheme);
  }

  const value = useMemo<PreferencesContextValue>(
    () => ({
      language,
      theme,
      resolvedTheme,
      setLanguage,
      setTheme,
      t: (key) => translate(language, key),
    }),
    [language, resolvedTheme, theme], // eslint-disable-line react-hooks/exhaustive-deps -- Setters are recreated with and close over these same preference values.
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);

  if (!context) {
    throw new Error("usePreferences must be used inside PreferencesProvider.");
  }

  return context;
}
