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

  const [displayName, setDisplayName] =
    useState("User");

  const [signingOut, setSigningOut] =
    useState(false);

  useEffect(() => {
    const supabase =
      createClient();

    const applyUser = (
      user: {
        email?: string | null;
        user_metadata?: Record<string, unknown>;
      } | null | undefined,
    ) => {
      const nextEmail = user?.email ?? "";
      const metadata =
        user?.user_metadata ?? {};

      const metadataName = [
        metadata.display_name,
        metadata.full_name,
        metadata.name,
      ].find(
        (value) =>
          typeof value === "string" &&
          value.trim(),
      );

      setEmail(nextEmail);
      setDisplayName(
        typeof metadataName === "string"
          ? metadataName.trim()
          : nextEmail.split("@")[0] || "User",
      );
    };

    void supabase.auth
      .getUser()
      .then(({ data }) => {
        applyUser(data.user);
      });

    const {
      data: authStateListener,
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        applyUser(session?.user);
      },
    );

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

      authStateListener.subscription.unsubscribe();
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

          <a href="/login?switch=1">
            Switch account
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
