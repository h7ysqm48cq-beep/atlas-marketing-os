"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { startPwaNavigationProgress } from "@/components/PwaNavigationProgress";

type NavItem = {
  label: string;
  href: string;
  icon: string;
};

const items: NavItem[] = [
  {
    label: "Home",
    href: "/",
    icon: "⌂",
  },
  {
    label: "AI Studio",
    href: "/ai-studio",
    icon: "✦",
  },
  {
    label: "Assets",
    href: "/assets",
    icon: "◇",
  },
  {
    label: "Automation",
    href: "/automation",
    icon: "↻",
  },
];

export function PwaMobileNav() {
  const pathname = usePathname();

  /*
   * Image Editor already has its own dedicated mobile tool dock.
   * Avoid stacking two fixed navigation bars.
   */
  if (pathname.startsWith("/image-editor")) {
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
            key={item.href}
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
