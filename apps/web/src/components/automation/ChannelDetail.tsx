"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type ChannelDetailResponse = {
  id: string;
  workspaceId?: string;
  platform: string;
  name: string;
  username: string | null;
  externalId: string | null;
  status: string;
  lastConnectedAt?: string | null;
  lastError?: string | null;
  brand?: {
    id: string;
    name: string;
  } | null;
  _count: {
    scheduledPosts: number;
  };
  scheduledPosts: Array<{
    id: string;
    title: string | null;
    content: string;
    status: string;
    scheduledAt: string;
    publishedAt: string | null;
    lastError: string | null;
  }>;
};

export function ChannelDetail({ channelId }: { channelId: string }) {
  const router = useRouter();

  const [channel, setChannel] = useState<ChannelDetailResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const workspaceId = window.localStorage.getItem("atlas:workspace-id");

        const query = workspaceId
          ? `?workspaceId=${encodeURIComponent(workspaceId)}`
          : "";

        const response = await fetch(
          `${API_URL}/automation/channels/${encodeURIComponent(
            channelId,
          )}${query}`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(
              "This account was not found in the current workspace.",
            );
          }

          throw new Error("Unable to load this account.");
        }

        const data = (await response.json()) as ChannelDetailResponse;

        if (!cancelled) {
          setChannel(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load this account.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  if (loading) {
    return <section style={{ padding: 24 }}>Loading account...</section>;
  }

  if (!channel) {
    return (
      <section style={{ padding: 24 }}>
        <button type="button" onClick={() => router.push("/automation")}>
          ← Back
        </button>

        <p>{error || "Account unavailable."}</p>
      </section>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <section>
        <button type="button" onClick={() => router.push("/automation")}>
          ← Connected platforms
        </button>
      </section>

      <section>
        <p
          style={{
            margin: 0,
            opacity: 0.65,
            fontSize: 12,
            textTransform: "uppercase",
          }}
        >
          {channel.platform}
        </p>

        <h1 style={{ marginBottom: 8 }}>{channel.name}</h1>

        <p style={{ marginTop: 0, opacity: 0.7 }}>
          {channel.username ? `@${channel.username}` : "No username"}
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <article>
          <small>Status</small>
          <h3>{channel.status}</h3>
        </article>

        <article>
          <small>Platform</small>
          <h3>{channel.platform}</h3>
        </article>

        <article>
          <small>Scheduled posts</small>
          <h3>{channel._count.scheduledPosts}</h3>
        </article>

        <article>
          <small>Brand</small>
          <h3>{channel.brand?.name || "—"}</h3>
        </article>
      </section>

      <section>
        <h2>Account details</h2>

        <div
          style={{
            display: "grid",
            gap: 10,
          }}
        >
          <div>
            <strong>Account ID: </strong>
            {channel.externalId || "—"}
          </div>

          <div>
            <strong>Username: </strong>
            {channel.username ? `@${channel.username}` : "—"}
          </div>

          <div>
            <strong>Connection: </strong>
            {channel.status}
          </div>

          {channel.lastError ? (
            <div>
              <strong>Last error: </strong>
              {channel.lastError}
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <h2>Recent posts</h2>

        {channel.scheduledPosts.length === 0 ? (
          <p>No posts for this account yet.</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {channel.scheduledPosts.map((post) => (
              <article
                key={post.id}
                style={{
                  padding: 14,
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 12,
                }}
              >
                <strong>{post.title || post.status}</strong>

                <p
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {post.content}
                </p>

                <small>{new Date(post.scheduledAt).toLocaleString()}</small>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
