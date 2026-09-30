"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { saveLastPwaRoute } from "@/components/pwaStartupConfig";

const EXCLUDED_ROUTES = ["/login"];

export function PwaRouteMemory() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) {
      return;
    }

    if (
      EXCLUDED_ROUTES.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`),
      )
    ) {
      return;
    }

    saveLastPwaRoute(pathname);
  }, [pathname]);

  return null;
}
