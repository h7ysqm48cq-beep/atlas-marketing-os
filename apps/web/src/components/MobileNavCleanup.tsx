"use client";

import { useEffect } from "react";

export function MobileNavCleanup() {
  useEffect(() => {
    const cleanup = () => {
      document.body.classList.remove("mobile-nav-open");
    };

    cleanup();

    window.addEventListener(
      "pageshow",
      cleanup
    );

    window.addEventListener(
      "atlas:mobile-navigation-close",
      cleanup
    );

    return () => {
      window.removeEventListener(
        "pageshow",
        cleanup
      );

      window.removeEventListener(
        "atlas:mobile-navigation-close",
        cleanup
      );
    };
  }, []);

  return null;
}
