"use client";

import {
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { usePreferences } from "@/components/preferences";
import styles from "./CalendarImageLightbox.module.css";

function isPreviewableCalendarImage(image: HTMLImageElement) {
  const className = String(image.className || "");

  return (
    className.includes("eventThumbnail") ||
    Boolean(image.closest('[class*="postMediaPreview"]')) ||
    Boolean(image.closest('[class*="selectedMediaItem"]'))
  );
}

export function CalendarImageLightbox({ children }: { children: ReactNode }) {
  const { language } = usePreferences();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState("");

  useEffect(() => {
    if (!imageUrl) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setImageUrl(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [imageUrl]);

  function handleCalendarClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;

    if (!(target instanceof HTMLImageElement)) {
      return;
    }

    if (!isPreviewableCalendarImage(target) || !target.currentSrc) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setImageUrl(target.currentSrc || target.src);
    setImageAlt(target.alt || (language === "zh" ? "日历图片" : "Calendar image"));
  }

  return (
    <div className={styles.scope} onClickCapture={handleCalendarClick}>
      {children}

      {imageUrl ? (
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label={language === "zh" ? "图片预览" : "Image preview"}
          onClick={() => setImageUrl(null)}
        >
          <div
            className={styles.viewer}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <strong>{language === "zh" ? "图片预览" : "Image preview"}</strong>

              <button
                type="button"
                aria-label={language === "zh" ? "关闭预览" : "Close preview"}
                onClick={() => setImageUrl(null)}
              >
                ×
              </button>
            </header>

            <div className={styles.imageStage}>
              <img src={imageUrl} alt={imageAlt} />
            </div>

            <footer>
              <a href={imageUrl} target="_blank" rel="noreferrer">
                {language === "zh" ? "打开原图" : "Open original"}
              </a>

              <button type="button" onClick={() => setImageUrl(null)}>
                {language === "zh" ? "关闭" : "Close"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
