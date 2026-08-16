"use client";

import { useCallback, useEffect, useState } from "react";

import { API_URL } from "@/lib/api";
import { useAtlasWorkspace } from "./ai-workspace-context";

type HistoryTab = "chat" | "studio";

type ConversationItem = {
  id: string;
  title?: string;
  updatedAt?: string;
  createdAt?: string;
};

type StudioHistoryItem = {
  id: string;
  topic?: string;
  style?: string;
  language?: string;
  createdAt?: string;
  updatedAt?: string;
};

const CONVERSATION_ENDPOINT = "/copilot/conversations";

const STUDIO_HISTORY_ENDPOINT = "/history";

function dateLabel(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ElenaUnifiedHistory() {
  const workspace = useAtlasWorkspace();

  const [tab, setTab] = useState<HistoryTab>("chat");

  const [conversations, setConversations] = useState<ConversationItem[]>([]);

  const [studioHistory, setStudioHistory] = useState<StudioHistoryItem[]>([]);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [conversationResponse, historyResponse] = await Promise.all([
        fetch(`${API_URL}${CONVERSATION_ENDPOINT}`, {
          cache: "no-store",
        }),

        fetch(`${API_URL}${STUDIO_HISTORY_ENDPOINT}`, {
          cache: "no-store",
        }),
      ]);

      if (!conversationResponse.ok) {
        throw new Error("Unable to load conversation history.");
      }

      if (!historyResponse.ok) {
        throw new Error("Unable to load Studio history.");
      }

      const conversationData = await conversationResponse.json();

      const historyData = await historyResponse.json();

      const conversationItems = Array.isArray(conversationData)
        ? conversationData
        : Array.isArray(conversationData?.conversations)
          ? conversationData.conversations
          : Array.isArray(conversationData?.items)
            ? conversationData.items
            : [];

      const historyItems = Array.isArray(historyData)
        ? historyData
        : Array.isArray(historyData?.items)
          ? historyData.items
          : Array.isArray(historyData?.history)
            ? historyData.history
            : [];

      setConversations(conversationItems);

      setStudioHistory(historyItems);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load history.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Refresh remote history when the active workspace context changes.
    void refresh();
  }, [refresh, workspace.conversationId, workspace.historyId]);

  function openConversation(id: string) {
    workspace.setConversationId(id);

    workspace.setPreferredMobileTab("elena");
  }

  function openStudioHistory(id: string) {
    workspace.setHistoryId(id);

    workspace.issueCommand({
      type: "restore-history",
      historyId: id,
    });
  }

  const itemCount =
    tab === "chat" ? conversations.length : studioHistory.length;

  return (
    <section
      style={{
        marginTop: 14,
        border: "1px solid rgba(127,127,127,.18)",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: 12,
          borderBottom: "1px solid rgba(127,127,127,.12)",
        }}
      >
        <div>
          <strong>Workspace History</strong>

          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              opacity: 0.56,
            }}
          >
            Chat + AI Studio
          </div>
        </div>

        <button type="button" onClick={() => void refresh()}>
          ↻
        </button>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          padding: 6,
          gap: 6,
        }}
      >
        <button type="button" onClick={() => setTab("chat")}>
          Chat · {conversations.length}
        </button>

        <button type="button" onClick={() => setTab("studio")}>
          Studio · {studioHistory.length}
        </button>
      </div>

      {loading ? (
        <div
          style={{
            padding: 14,
            fontSize: 12,
            opacity: 0.6,
          }}
        >
          Loading history…
        </div>
      ) : error ? (
        <div
          style={{
            padding: 14,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : itemCount === 0 ? (
        <div
          style={{
            padding: 14,
            fontSize: 12,
            opacity: 0.6,
          }}
        >
          No history yet.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            maxHeight: 330,
            overflowY: "auto",
          }}
        >
          {tab === "chat"
            ? conversations.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => openConversation(item.id)}
                >
                  <strong>{item.title || "Conversation"}</strong>

                  <small>{dateLabel(item.updatedAt || item.createdAt)}</small>
                </button>
              ))
            : studioHistory.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => openStudioHistory(item.id)}
                >
                  <strong>{item.topic || "AI Studio work"}</strong>

                  <small>
                    {[item.style, item.language].filter(Boolean).join(" · ")}
                  </small>

                  <small>{dateLabel(item.updatedAt || item.createdAt)}</small>
                </button>
              ))}
        </div>
      )}
    </section>
  );
}
