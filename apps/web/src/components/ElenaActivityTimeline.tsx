"use client";

import { useAtlasWorkspace } from "./ai-workspace-context";

function iconFor(
  type: "edit" | "generate" | "restore" | "schedule" | "system",
) {
  if (type === "schedule") {
    return "◷";
  }

  if (type === "restore") {
    return "↺";
  }

  if (type === "generate") {
    return "✦";
  }

  if (type === "system") {
    return "•";
  }

  return "✓";
}

export function ElenaActivityTimeline() {
  const workspace = useAtlasWorkspace();

  if (!workspace.activities.length) {
    return null;
  }

  return (
    <section
      style={{
        marginTop: 14,
        padding: 14,
        border: "1px solid rgba(127,127,127,.18)",
        borderRadius: 16,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <strong>Elena Activity</strong>

          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              opacity: 0.58,
            }}
          >
            Workspace actions
          </div>
        </div>

        <button
          type="button"
          onClick={workspace.clearActivities}
          style={{
            border: 0,
            padding: "4px 6px",
            background: "transparent",
            color: "inherit",
            font: "inherit",
            fontSize: 11,
            cursor: "pointer",
            opacity: 0.6,
          }}
        >
          Clear
        </button>
      </header>

      <div
        style={{
          display: "grid",
          gap: 10,
        }}
      >
        {workspace.activities.slice(0, 10).map((activity) => (
          <article
            key={activity.id}
            style={{
              display: "grid",
              gridTemplateColumns: "24px minmax(0,1fr)",
              gap: 8,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                opacity: 0.75,
              }}
            >
              {iconFor(activity.type)}
            </span>

            <div
              style={{
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 650,
                }}
              >
                {activity.label}
              </div>

              {activity.detail ? (
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 11,
                    opacity: 0.58,
                    overflowWrap: "anywhere",
                  }}
                >
                  {activity.detail}
                </div>
              ) : null}

              <time
                dateTime={activity.createdAt}
                style={{
                  display: "block",
                  marginTop: 3,
                  fontSize: 10,
                  opacity: 0.42,
                }}
              >
                {new Date(activity.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          </article>
        ))}
      </div>

      <footer
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px solid rgba(127,127,127,.12)",
          fontSize: 11,
          opacity: 0.55,
        }}
      >
        🔒 Publish now is locked. Schedule remains available.
      </footer>
    </section>
  );
}
