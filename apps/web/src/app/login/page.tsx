"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "../../lib/supabase/client";
import styles from "./page.module.css";

export default function LoginPage() {
  const emailRef =
    useRef<HTMLInputElement>(null);

  const passwordRef =
    useRef<HTMLInputElement>(null);

  const [loading, setLoading] =
    useState(false);

  const [preparingSwitch, setPreparingSwitch] =
    useState(false);

  const [error, setError] =
    useState("");

  const [status, setStatus] =
    useState("Ready");

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search,
      );

    if (params.get("switch") !== "1") {
      return;
    }

    const supabase =
      createClient();

    setPreparingSwitch(true);
    setStatus("Preparing account switch...");

    void supabase.auth
      .signOut({ scope: "local" })
      .then(({ error: signOutError }) => {
        if (signOutError) {
          throw signOutError;
        }

        setStatus("Ready");
      })
      .catch((signOutError) => {
        console.error(
          "Atlas account switch failed:",
          signOutError,
        );

        setError(
          signOutError instanceof Error
            ? signOutError.message
            : "Unable to switch account.",
        );
        setStatus("Account switch failed");
      })
      .finally(() => {
        setPreparingSwitch(false);
      });
  }, []);

  async function performLogin() {
    if (loading || preparingSwitch) {
      return;
    }

    setError("");
    setStatus("Reading form...");

    const email =
      emailRef.current?.value
        .trim() || "";

    const password =
      passwordRef.current?.value || "";

    if (!email || !password) {
      setError(
        "Enter your email and password.",
      );
      setStatus("Form incomplete");
      return;
    }

    setLoading(true);
    setStatus(
      "Connecting to Supabase...",
    );

    try {
      const supabase =
        createClient();

      setStatus(
        "Sending login request...",
      );

      const {
        data,
        error: loginError,
      } = await supabase.auth
        .signInWithPassword({
          email,
          password,
        });

      if (loginError) {
        throw loginError;
      }

      if (!data.session) {
        throw new Error(
          "Login succeeded but no session was returned.",
        );
      }

      await supabase.auth.refreshSession();

      setStatus(
        "Login successful. Redirecting...",
      );

      const params =
        new URLSearchParams(
          window.location.search,
        );

      const destination =
        params.get("next") ||
        "/engineering";

      window.location.href =
        destination;
    } catch (loginError) {
      console.error(
        "Atlas login failed:",
        loginError,
      );

      const message =
        loginError instanceof Error
          ? loginError.message
          : "Unable to sign in.";

      setError(message);
      setStatus("Login failed");
      setLoading(false);
    }
  }

  function submit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void performLogin();
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
          onSubmit={submit}
          className={styles.form}
          noValidate
        >
          <label>
            <span>Email</span>

            <input
              ref={emailRef}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              disabled={preparingSwitch}
            />
          </label>

          <label>
            <span>Password</span>

            <input
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter password"
              disabled={preparingSwitch}
            />
          </label>

          <small>
            Status: {status}
          </small>

          {error ? (
            <p className={styles.error}>
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={loading || preparingSwitch}
            onClick={() => {
              console.log("LOGIN BUTTON CLICKED");
              setStatus("Button clicked");
              void performLogin();
            }}
          >
            {preparingSwitch
              ? "Preparing account switch..."
              : loading
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
