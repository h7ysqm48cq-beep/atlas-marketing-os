"use client";

import { useEffect } from "react";
import { API_URL } from "@/lib/api";
import { readNotificationTypes } from "@/components/notificationPreferences";

const ENABLED_KEY = "atlas.notifications.enabled";
const SNAPSHOT_KEY = "atlas.notifications.snapshot";
const POLL_MS = 30_000;

type Post = {
  id: string;
  title?: string;
  platform?: string;
  status?: string;
  lastError?: string | null;
  publishedAt?: string | null;
  updatedAt?: string;
  externalPostUrl?: string | null;
  channel?: { name?: string } | null;
};

type Snapshot = Record<string, { status?: string; version: string }>;

function readSnapshot(): Snapshot {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "{}");
  } catch {
    return {};
  }
}

function notifyPost(post: Post) {
  const platform = post.platform || "SOCIAL";
  const channel = post.channel?.name || "未命名频道";
  const title = post.title || "未命名帖子";
  const published = post.status === "PUBLISHED";
  const category = published ? "published" : "failed";
  if (!readNotificationTypes()[category]) return;
  const notificationTitle = `${platform} ${published ? "发布成功" : "发布失败"}`;
  const detail = published
    ? `${channel}\n${title}`
    : `${channel}\n${title}\n原因：${post.lastError || "发布未确认"}\n系统将按策略自动重试。`;
  const target =
    post.externalPostUrl || `/calendar?post=${encodeURIComponent(post.id)}`;

  void navigator.serviceWorker?.ready.then((registration) => {
    void registration.showNotification(notificationTitle, {
      body: detail,
      tag: `atlas-post-${post.id}-${post.status}`,
      data: { url: target },
    });
  });
}

function notificationsEnabled() {
  return (
    localStorage.getItem(ENABLED_KEY) === "true" &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  );
}

function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function PwaNotifications() {
  useEffect(() => {
    let firstPoll = true;
    let pushRegistered = false;

    const syncPushSubscription = async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({
        type: "notification-preferences",
        preferences: readNotificationTypes(),
      });
      const pushManager = registration.pushManager;
      if (!pushManager) return;

      const existing = await pushManager.getSubscription();
      if (!notificationsEnabled()) {
        if (existing) {
          await fetch(`${API_URL}/notifications/subscriptions`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: existing.endpoint }),
          }).catch(() => undefined);
          await existing.unsubscribe().catch(() => undefined);
        }
        pushRegistered = false;
        return;
      }

      if (pushRegistered) return;
      const configResponse = await fetch(`${API_URL}/notifications/vapid-public-key`, {
        cache: "no-store",
      });
      if (!configResponse.ok) return;
      const config = (await configResponse.json()) as { enabled?: boolean; publicKey?: string | null };
      if (!config.enabled || !config.publicKey) return;
      const subscription = existing || await pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(config.publicKey),
      });
      const saveResponse = await fetch(`${API_URL}/notifications/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (saveResponse.ok) pushRegistered = true;
    };

    const poll = async () => {
      try {
        await syncPushSubscription();
        const now = new Date();
        const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const url = new URL(`${API_URL}/automation/posts/calendar`);
        url.searchParams.set("from", from.toISOString());
        url.searchParams.set("to", now.toISOString());
        url.searchParams.set("limit", "300");
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return;
        const posts = (await response.json()) as Post[];
        const previous = readSnapshot();
        const hadPreviousSnapshot = Object.keys(previous).length > 0;
        const next: Snapshot = {};

        for (const post of posts) {
          const version = `${post.status || ""}:${post.publishedAt || post.updatedAt || ""}:${post.externalPostUrl || ""}`;
          next[post.id] = { status: post.status, version };
          const old = previous[post.id];
          const changed = old && old.version !== version;
          const relevant =
            post.status === "PUBLISHED" || post.status === "FAILED";
          const enabled = notificationsEnabled();
          if (
            changed &&
            relevant &&
            enabled &&
            (!firstPoll || hadPreviousSnapshot)
          ) {
            notifyPost(post);
          }
        }

        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
        firstPoll = false;
      } catch {
        // Notification polling must never interrupt the publishing UI.
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);
    const onNotificationSettingChanged = () => void syncPushSubscription();
    window.addEventListener("atlas:notifications-changed", onNotificationSettingChanged);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("atlas:notifications-changed", onNotificationSettingChanged);
    };
  }, []);

  return null;
}
