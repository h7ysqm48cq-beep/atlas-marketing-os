"use client";

import {
  useEffect,
  useState,
} from "react";

import { API_URL } from "@/lib/api";

const IMAGE_SCOPE_KEY = "atlas-image-generation-scope";

type ScopeType =
  | "workspace"
  | "page"
  | "channel";

type FooterPosition =
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

type FooterStyle =
  | "minimal"
  | "premium"
  | "watermark";

type FooterLogoMode =
  | "auto"
  | "show"
  | "hide";

type CornerLogoPlacement =
  | "AUTO"
  | "TOP_LEFT"
  | "TOP_CENTER"
  | "TOP_RIGHT"
  | "CENTER_LEFT"
  | "CENTER"
  | "CENTER_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_CENTER"
  | "BOTTOM_RIGHT";

type ScopeItem = {
  id: string;
  name: string;
  platform?: string;
  status?: string;
};

type ScopeResponse = {
  pages?: ScopeItem[];
  channels?: ScopeItem[];
};

type SettingResponse = {
  textOverlayEnabled?: boolean;
  brandFooterEnabled?: boolean;
  footerText?: string;
  footerPosition?: FooterPosition;
  footerStyle?: FooterStyle;
  footerLogoMode?: FooterLogoMode;

  cornerLogoEnabled?: boolean;
  cornerLogoPlacement?: CornerLogoPlacement;
  cornerLogoScale?: number;
  cornerLogoOpacity?: number;
  effectiveScope?: string;
  inherited?: boolean;
};

function readRuntimeScope(): {
  type: ScopeType;
  id: string;
} {
  if (typeof window === "undefined") {
    return {
      type: "workspace",
      id: "",
    };
  }

  try {
    const raw =
      window.localStorage.getItem(
        IMAGE_SCOPE_KEY,
      );

    if (!raw) {
      return {
        type: "workspace",
        id: "",
      };
    }

    const parsed = JSON.parse(raw) as {
      scopeType?: ScopeType;
      pageId?: string;
      channelId?: string;
    };

    if (
      parsed.scopeType === "page" &&
      parsed.pageId
    ) {
      return {
        type: "page",
        id: parsed.pageId,
      };
    }

    if (
      parsed.scopeType === "channel" &&
      parsed.channelId
    ) {
      return {
        type: "channel",
        id: parsed.channelId,
      };
    }
  } catch {
    // Ignore invalid stored scope.
  }

  return {
    type: "workspace",
    id: "",
  };
}

function persistRuntimeScope(
  type: ScopeType,
  id: string,
) {
  if (typeof window === "undefined") {
    return;
  }

  const payload =
    type === "page" && id
      ? {
          scopeType: "page",
          pageId: id,
        }
      : type === "channel" && id
        ? {
            scopeType: "channel",
            channelId: id,
          }
        : {
            scopeType: "workspace",
          };

  window.localStorage.setItem(
    IMAGE_SCOPE_KEY,
    JSON.stringify(payload),
  );

  window.dispatchEvent(
    new CustomEvent(
      "atlas-image-generation-scope-change",
      {
        detail: payload,
      },
    ),
  );
}

export default function ImageGenerationSettings() {
  const [scopeType, setScopeType] =
    useState<ScopeType>("workspace");

  const [
    selectedScopeId,
    setSelectedScopeId,
  ] = useState("");

  const [pages, setPages] =
    useState<ScopeItem[]>([]);

  const [channels, setChannels] =
    useState<ScopeItem[]>([]);

  const [textOverlay, setTextOverlay] =
    useState(true);

  const [footer, setFooter] =
    useState(true);

  const [footerText, setFooterText] =
    useState(
      "满贯门 mgmbetmyr.com",
    );

  const [
    footerPosition,
    setFooterPosition,
  ] = useState<FooterPosition>(
    "bottom-center",
  );

  const [
    footerStyle,
    setFooterStyle,
  ] = useState<FooterStyle>(
    "minimal",
  );

  const [
    footerLogoMode,
    setFooterLogoMode,
  ] = useState<FooterLogoMode>(
    "auto",
  );

  const [
    cornerLogoEnabled,
    setCornerLogoEnabled,
  ] = useState(false);

  const [
    cornerLogoPlacement,
    setCornerLogoPlacement,
  ] = useState<CornerLogoPlacement>(
    "TOP_RIGHT",
  );

  const [
    cornerLogoScale,
    setCornerLogoScale,
  ] = useState(1);

  const [
    cornerLogoOpacity,
    setCornerLogoOpacity,
  ] = useState(1);

  const [
    effectiveScope,
    setEffectiveScope,
  ] = useState("workspace");

  const [inherited, setInherited] =
    useState(false);

  const [message, setMessage] =
    useState("");

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    const saved =
      readRuntimeScope();

    setScopeType(saved.type);
    setSelectedScopeId(saved.id);

    await Promise.all([
      loadScopes(),
      loadSettings(
        saved.type,
        saved.id,
      ),
    ]);
  }

  async function loadScopes() {
    try {
      const response = await fetch(
        `${API_URL}/image-settings/scopes`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return;
      }

      const data =
        (await response.json()) as ScopeResponse;

      setPages(
        Array.isArray(data.pages)
          ? data.pages
          : [],
      );

      setChannels(
        Array.isArray(data.channels)
          ? data.channels
          : [],
      );
    } catch {
      setMessage(
        "Unable to load scopes",
      );
    }
  }

  function buildQuery(
    type: ScopeType,
    id: string,
  ) {
    if (
      type === "page" &&
      id
    ) {
      return `?pageId=${encodeURIComponent(
        id,
      )}`;
    }

    if (
      type === "channel" &&
      id
    ) {
      return `?channelId=${encodeURIComponent(
        id,
      )}`;
    }

    return "";
  }

  function scopePayload() {
    if (
      scopeType === "page" &&
      selectedScopeId
    ) {
      return {
        pageId:
          selectedScopeId,
      };
    }

    if (
      scopeType === "channel" &&
      selectedScopeId
    ) {
      return {
        channelId:
          selectedScopeId,
      };
    }

    return {};
  }

  function applySettings(
    data: SettingResponse,
  ) {
    setTextOverlay(
      data.textOverlayEnabled ??
        true,
    );

    setFooter(
      data.brandFooterEnabled ??
        true,
    );

    setFooterText(
      data.footerText ??
        "满贯门 mgmbetmyr.com",
    );

    setFooterPosition(
      data.footerPosition ??
        "bottom-center",
    );

    setFooterStyle(
      data.footerStyle ??
        "minimal",
    );

    setFooterLogoMode(
      data.footerLogoMode ??
        "auto",
    );

    setCornerLogoEnabled(
      data.cornerLogoEnabled ??
        false,
    );

    setCornerLogoPlacement(
      data.cornerLogoPlacement ??
        "TOP_RIGHT",
    );

    setCornerLogoScale(
      typeof data.cornerLogoScale ===
        "number"
        ? data.cornerLogoScale
        : 1,
    );

    setCornerLogoOpacity(
      typeof data.cornerLogoOpacity ===
        "number"
        ? data.cornerLogoOpacity
        : 1,
    );

    setEffectiveScope(
      data.effectiveScope ??
        "workspace",
    );

    setInherited(
      data.inherited ?? false,
    );
  }

  async function loadSettings(
    type: ScopeType,
    id: string,
  ) {
    if (
      type !== "workspace" &&
      !id
    ) {
      return;
    }

    setMessage("Loading...");

    try {
      const query =
        buildQuery(
          type,
          id,
        );

      const response =
        await fetch(
          `${API_URL}/image-settings${query}`,
          {
            cache: "no-store",
          },
        );

      if (!response.ok) {
        setMessage(
          "Unable to load settings",
        );
        return;
      }

      const data =
        (await response.json()) as SettingResponse;

      applySettings(data);
      setMessage("");
    } catch {
      setMessage(
        "Unable to load settings",
      );
    }
  }

  async function save(
    payload: Record<
      string,
      unknown
    >,
  ) {
    if (
      scopeType !== "workspace" &&
      !selectedScopeId
    ) {
      return;
    }

    setMessage("Saving...");

    try {
      const response =
        await fetch(
          `${API_URL}/image-settings`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              ...scopePayload(),
              ...payload,
            }),
          },
        );

      if (!response.ok) {
        setMessage(
          "Unable to save",
        );
        return;
      }

      await loadSettings(
        scopeType,
        selectedScopeId,
      );

      setMessage("Saved");
    } catch {
      setMessage(
        "Unable to save",
      );
    }
  }

  async function resetOverride() {
    if (
      scopeType === "workspace" ||
      !selectedScopeId
    ) {
      return;
    }

    setMessage("Resetting...");

    const query =
      buildQuery(
        scopeType,
        selectedScopeId,
      );

    try {
      const response =
        await fetch(
          `${API_URL}/image-settings${query}`,
          {
            method: "DELETE",
          },
        );

      if (!response.ok) {
        setMessage(
          "Unable to reset",
        );
        return;
      }

      await loadSettings(
        scopeType,
        selectedScopeId,
      );

      setMessage(
        "Using inherited settings",
      );
    } catch {
      setMessage(
        "Unable to reset",
      );
    }
  }

  function changeScope(
    next: ScopeType,
  ) {
    setScopeType(next);
    setSelectedScopeId("");
    setMessage("");

    persistRuntimeScope(
      "workspace",
      "",
    );

    if (next === "workspace") {
      void loadSettings(
        "workspace",
        "",
      );
    }
  }

  function selectScope(
    id: string,
  ) {
    setSelectedScopeId(id);

    if (id) {
      persistRuntimeScope(
        scopeType,
        id,
      );

      void loadSettings(
        scopeType,
        id,
      );
    } else {
      persistRuntimeScope(
        "workspace",
        "",
      );
    }
  }

  const availableScopes =
    scopeType === "page"
      ? pages
      : channels;

  const scopeReady =
    scopeType === "workspace" ||
    Boolean(selectedScopeId);

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        marginBottom: 24,
      }}
    >
      <h3>
        Image Generation Settings
      </h3>

      <label>
        Setting Scope
        <select
          value={scopeType}
          onChange={(event) =>
            changeScope(
              event.target
                .value as ScopeType,
            )
          }
        >
          <option value="workspace">
            Workspace Default
          </option>

          <option value="page">
            Facebook Page
          </option>

          <option value="channel">
            Social Channel
          </option>
        </select>
      </label>

      {scopeType !== "workspace" ? (
        <label>
          {scopeType === "page"
            ? "Page"
            : "Channel"}

          <select
            value={selectedScopeId}
            onChange={(event) =>
              selectScope(
                event.target.value,
              )
            }
          >
            <option value="">
              Select...
            </option>

            {availableScopes.map(
              (item) => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.platform
                    ? `${item.platform} · `
                    : ""}
                  {item.name}
                  {item.status
                    ? ` · ${item.status}`
                    : ""}
                </option>
              ),
            )}
          </select>
        </label>
      ) : null}

      {scopeReady ? (
        <>
          <div>
            Using:{" "}
            <strong>
              {inherited
                ? `${effectiveScope} inherited`
                : effectiveScope}
            </strong>
          </div>

          <label>
            <input
              type="checkbox"
              checked={textOverlay}
              onChange={(event) => {
                const value =
                  event.target.checked;

                setTextOverlay(value);

                void save({
                  textOverlayEnabled:
                    value,
                });
              }}
            />
            {" "}
            Text Overlay
          </label>

          <label>
            <input
              type="checkbox"
              checked={footer}
              onChange={(event) => {
                const value =
                  event.target.checked;

                setFooter(value);

                void save({
                  brandFooterEnabled:
                    value,
                });
              }}
            />
            {" "}
            Brand Signature
          </label>

          <label>
            Official Logo
            <select
              value={footerLogoMode}
              disabled={!footer}
              onChange={(event) => {
                const value =
                  event.target
                    .value as FooterLogoMode;

                setFooterLogoMode(
                  value,
                );

                void save({
                  footerLogoMode:
                    value,
                });
              }}
            >
              <option value="auto">
                Auto
              </option>

              <option value="show">
                Show
              </option>

              <option value="hide">
                Hide
              </option>
            </select>

            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                opacity: 0.7,
              }}
            >
              {footerLogoMode === "auto"
                ? "Auto · Use the official brand logo when appropriate."
                : footerLogoMode === "show"
                  ? "Show · Always use the official brand logo when available."
                  : "Hide · Keep footer text without the logo."}
            </div>
          </label>

          <label>
            Footer Text
            <input
              value={footerText}
              disabled={!footer}
              onChange={(event) =>
                setFooterText(
                  event.target.value,
                )
              }
              onBlur={() =>
                void save({
                  footerText,
                })
              }
            />
          </label>

          <label>
            Footer Position
            <select
              value={footerPosition}
              disabled={!footer}
              onChange={(event) => {
                const value =
                  event.target
                    .value as FooterPosition;

                setFooterPosition(
                  value,
                );

                void save({
                  footerPosition:
                    value,
                });
              }}
            >
              <option value="bottom-left">
                Bottom Left
              </option>

              <option value="bottom-center">
                Bottom Center
              </option>

              <option value="bottom-right">
                Bottom Right
              </option>
            </select>
          </label>

          <label>
            Footer Style
            <select
              value={footerStyle}
              disabled={!footer}
              onChange={(event) => {
                const value =
                  event.target
                    .value as FooterStyle;

                setFooterStyle(
                  value,
                );

                void save({
                  footerStyle:
                    value,
                });
              }}
            >
              <option value="minimal">
                Minimal
              </option>

              <option value="premium">
                Premium
              </option>

              <option value="watermark">
                Watermark
              </option>
            </select>
          </label>

          <div
            style={{
              marginTop: 8,
              paddingTop: 14,
              borderTop:
                "1px solid rgba(128,128,128,0.25)",
            }}
          >
            <strong>
              Corner Logo
            </strong>

            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                opacity: 0.7,
              }}
            >
              Independent official logo placed outside the footer signature.
            </div>
          </div>

          <label>
            <input
              type="checkbox"
              checked={cornerLogoEnabled}
              onChange={(event) => {
                const value =
                  event.target.checked;

                setCornerLogoEnabled(
                  value,
                );

                void save({
                  cornerLogoEnabled:
                    value,
                });
              }}
            />
            {" "}
            Enable Corner Logo
          </label>

          <label>
            Corner Logo Position

            <select
              value={cornerLogoPlacement}
              disabled={!cornerLogoEnabled}
              onChange={(event) => {
                const value =
                  event.target
                    .value as CornerLogoPlacement;

                setCornerLogoPlacement(
                  value,
                );

                void save({
                  cornerLogoPlacement:
                    value,
                });
              }}
            >
              <option value="TOP_RIGHT">
                Top Right · Recommended
              </option>

              <option value="TOP_LEFT">
                Top Left
              </option>

              <option value="TOP_CENTER">
                Top Center
              </option>

              <option value="BOTTOM_RIGHT">
                Bottom Right
              </option>

              <option value="BOTTOM_LEFT">
                Bottom Left
              </option>

              <option value="BOTTOM_CENTER">
                Bottom Center
              </option>

              <option value="CENTER_RIGHT">
                Center Right
              </option>

              <option value="CENTER_LEFT">
                Center Left
              </option>

              <option value="CENTER">
                Center
              </option>

              <option value="AUTO">
                Auto
              </option>
            </select>
          </label>

          <label>
            Corner Logo Size

            <select
              value={cornerLogoScale}
              disabled={!cornerLogoEnabled}
              onChange={(event) => {
                const value =
                  Number(
                    event.target.value,
                  );

                setCornerLogoScale(
                  value,
                );

                void save({
                  cornerLogoScale:
                    value,
                });
              }}
            >
              <option value={0.7}>
                Small
              </option>

              <option value={0.85}>
                Compact
              </option>

              <option value={1}>
                Standard · Recommended
              </option>

              <option value={1.2}>
                Large
              </option>

              <option value={1.4}>
                Extra Large
              </option>
            </select>
          </label>

          <label>
            Corner Logo Opacity

            <select
              value={cornerLogoOpacity}
              disabled={!cornerLogoEnabled}
              onChange={(event) => {
                const value =
                  Number(
                    event.target.value,
                  );

                setCornerLogoOpacity(
                  value,
                );

                void save({
                  cornerLogoOpacity:
                    value,
                });
              }}
            >
              <option value={1}>
                100% · Solid
              </option>

              <option value={0.9}>
                90% · Recommended
              </option>

              <option value={0.75}>
                75%
              </option>

              <option value={0.6}>
                60% · Subtle
              </option>

              <option value={0.4}>
                40% · Watermark
              </option>
            </select>
          </label>


          {scopeType !==
          "workspace" ? (
            <button
              type="button"
              onClick={() =>
                void resetOverride()
              }
            >
              Reset to inherited settings
            </button>
          ) : null}
        </>
      ) : null}

      {message ? (
        <small>
          {message}
        </small>
      ) : null}
    </div>
  );
}
