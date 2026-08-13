"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { startPwaNavigationProgress } from "@/components/PwaNavigationProgress";

import {
  DEFAULT_PWA_NAVIGATION,
  PWA_NAV_CHANGE_EVENT,
  PWA_NAV_ROUTES,
  readPwaNavigationSettings,
  type PwaNavigationSettings,
} from "@/components/pwaNavigationSettings";

export function PwaMobileNav() {
  const pathname = usePathname();

  const [settings, setSettings] = useState<PwaNavigationSettings>(
    DEFAULT_PWA_NAVIGATION,
  );

  useEffect(() => {
    const update = () => {
      setSettings(readPwaNavigationSettings());
    };

    update();

    window.addEventListener(PWA_NAV_CHANGE_EVENT, update);

    window.addEventListener("storage", update);

    return () => {
      window.removeEventListener(PWA_NAV_CHANGE_EVENT, update);

      window.removeEventListener("storage", update);
    };
  }, []);

  const items = useMemo(
    () =>
      settings.quickLinks
        .map((id) => PWA_NAV_ROUTES.find((route) => route.id === id))
        .filter((route): route is (typeof PWA_NAV_ROUTES)[number] =>
          Boolean(route),
        ),
    [settings.quickLinks],
  );

  if (!settings.enabled || pathname.startsWith("/image-editor")) {
    return null;
  }

  function isActive(href: string) {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function openMore() {
    window.dispatchEvent(new CustomEvent("atlas:toggle-mobile-navigation"));
  }

  const primaryRouteActive = items.some((item) => isActive(item.href));

  return (
    <nav className="atlas-pwa-mobile-nav" aria-label="Atlas mobile navigation">
      {items.map((item) => {
        const active = isActive(item.href);

        return (
          <Link
            key={item.id}
            href={item.href}
            onClick={(event) => {
              if (active) {
                return;
              }

              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }

              startPwaNavigationProgress();
            }}
            className={`atlas-pwa-mobile-nav__item${
              active ? " is-active" : ""
            }`}
            aria-current={active ? "page" : undefined}
          >
            <span className="atlas-pwa-mobile-nav__icon" aria-hidden="true">
              {item.icon}
            </span>

            <span className="atlas-pwa-mobile-nav__label">{item.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        className={`atlas-pwa-mobile-nav__item atlas-pwa-mobile-nav__more${
          !primaryRouteActive ? " is-active" : ""
        }`}
        onClick={openMore}
        aria-label="More Atlas sections"
      >
        <span className="atlas-pwa-mobile-nav__icon" aria-hidden="true">
          •••
        </span>

        <span className="atlas-pwa-mobile-nav__label">More</span>
      </button>
    </nav>
  );
}
