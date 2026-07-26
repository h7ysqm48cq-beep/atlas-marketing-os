"use client";

import {
  FormEvent,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function login(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setError("");

    if (
      !email.trim() ||
      !password
    ) {
      setError(
        "Enter your email and password.",
      );
      return;
    }

    setLoading(true);

    try {
      const supabase =
        createClient();

      const { error: loginError } =
        await supabase.auth
          .signInWithPassword({
            email: email.trim(),
            password,
          });

      if (loginError) {
        throw loginError;
      }

      const params =
        new URLSearchParams(
          window.location.search,
        );

      const destination =
        params.get("next") || "/";

      router.replace(destination);
      router.refresh();
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Unable to sign in.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            A
          </div>

          <div>
            <strong>Atlas</strong>
            <span>
              AI Marketing Suite
            </span>
          </div>
        </div>

        <div className={styles.intro}>
          <p>Internal access</p>

          <h1>
            Welcome back to Atlas.
          </h1>

          <span>
            Sign in to generate,
            schedule and publish
            content with your team.
          </span>
        </div>

        <form
          onSubmit={login}
          className={styles.form}
        >
          <label>
            <span>Email</span>

            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value,
                )
              }
              placeholder="name@company.com"
            />
          </label>

          <label>
            <span>Password</span>

            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value,
                )
              }
              placeholder="Enter password"
            />
          </label>

          {error ? (
            <p className={styles.error}>
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Signing in..."
              : "Sign in"}
          </button>
        </form>

        <small className={styles.footer}>
          Private internal workspace
        </small>
      </section>
    </main>
  );
}
