"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./UserMenu.module.css";

export function UserMenu() {
  const router = useRouter();
  const menuRef =
    useRef<HTMLDivElement | null>(null);

  const [open, setOpen] =
    useState(false);

  const [email, setEmail] =
    useState("");

  const [signingOut, setSigningOut] =
    useState(false);

  useEffect(() => {
    const supabase =
      createClient();

    void supabase.auth
      .getUser()
      .then(({ data }) => {
        setEmail(
          data.user?.email ?? "",
        );
      });

    function closeMenu(
      event: MouseEvent,
    ) {
      if (
        menuRef.current &&
        !menuRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      closeMenu,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        closeMenu,
      );
    };
  }, []);

  async function signOut() {
    setSigningOut(true);

    try {
      const supabase =
        createClient();

      const { error } =
        await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const displayName =
    email
      ? email.split("@")[0]
      : "Loh";

  return (
    <div
      className={styles.wrapper}
      ref={menuRef}
    >
      <button
        type="button"
        className={styles.trigger}
        onClick={() =>
          setOpen((current) => !current)
        }
        aria-expanded={open}
        aria-label="Open account menu"
      >
        <div className={styles.avatar}>
          {displayName
            .charAt(0)
            .toUpperCase()}
        </div>

        <div className={styles.details}>
          <strong>{displayName}</strong>
          <span>Administrator</span>
        </div>

        <i>⌄</i>
      </button>

      {open ? (
        <section className={styles.menu}>
          <div className={styles.account}>
            <span>Signed in as</span>
            <strong>
              {email || "Atlas administrator"}
            </strong>
          </div>

          <a href="/settings">
            Settings
          </a>

          <button
            type="button"
            onClick={() =>
              void signOut()
            }
            disabled={signingOut}
          >
            {signingOut
              ? "Signing out..."
              : "Sign out"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
