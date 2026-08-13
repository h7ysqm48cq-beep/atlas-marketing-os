"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export type AtlasWorkspaceMobileTab = "create" | "results" | "elena";

export type AtlasWorkspaceDraft = {
  facebook?: string;
  telegram?: string;
  reels?: string;
  imagePrompt?: string;
};

/*
 * Keep command INPUT separate from the
 * issued command.
 *
 * This avoids Omit<> collapsing discriminated
 * union fields such as restore-history.historyId.
 */
export type AtlasWorkspaceCommandInput =
  | {
      type: "generate-content";
    }
  | {
      type: "generate-image";
    }
  | {
      type: "restore-history";
      historyId: string;
    };

export type AtlasWorkspaceCommand = AtlasWorkspaceCommandInput & {
  id: number;
};

export type AtlasWorkspaceActivity = {
  id: number;

  type: "edit" | "generate" | "restore" | "schedule" | "system";

  label: string;
  detail?: string;

  status?: "pending" | "success" | "error";

  createdAt: string;
};

export type AtlasWorkspaceContextValue = {
  preferredMobileTab: AtlasWorkspaceMobileTab;

  setPreferredMobileTab: (value: AtlasWorkspaceMobileTab) => void;

  conversationId: string;
  historyId: string;
  campaignId: string;
  ideaId: string;

  topic: string;
  style: string;
  language: string;

  assetIds: string[];

  draft: AtlasWorkspaceDraft;

  command: AtlasWorkspaceCommand | null;

  activities: AtlasWorkspaceActivity[];

  setConversationId: (value: string) => void;

  setHistoryId: (value: string) => void;

  setCampaignId: (value: string) => void;

  setIdeaId: (value: string) => void;

  setTopic: (value: string) => void;

  setStyle: (value: string) => void;

  setLanguage: (value: string) => void;

  setAssetIds: (value: string[]) => void;

  setDraft: Dispatch<SetStateAction<AtlasWorkspaceDraft>>;

  issueCommand: (command: AtlasWorkspaceCommandInput) => void;

  addActivity: (
    activity: Omit<AtlasWorkspaceActivity, "id" | "createdAt">,
  ) => void;

  clearActivities: () => void;

  resetWorkspace: () => void;
};

const AtlasWorkspaceContext = createContext<AtlasWorkspaceContextValue | null>(
  null,
);

export function AtlasWorkspaceProvider({ children }: { children: ReactNode }) {
  const [conversationId, setConversationId] = useState("");

  const [historyId, setHistoryId] = useState("");

  const [campaignId, setCampaignId] = useState("");

  const [ideaId, setIdeaId] = useState("");

  const [topic, setTopic] = useState("");

  const [style, setStyle] = useState("");

  const [language, setLanguage] = useState("");

  const [assetIds, setAssetIds] = useState<string[]>([]);

  const [draft, setDraft] = useState<AtlasWorkspaceDraft>({});

  const [command, setCommand] = useState<AtlasWorkspaceCommand | null>(null);

  const [activities, setActivities] = useState<AtlasWorkspaceActivity[]>([]);

  const [preferredMobileTab, setPreferredMobileTab] =
    useState<AtlasWorkspaceMobileTab>("create");

  function issueCommand(next: AtlasWorkspaceCommandInput) {
    setCommand({
      ...next,
      id: Date.now(),
    });
  }

  function addActivity(
    activity: Omit<AtlasWorkspaceActivity, "id" | "createdAt">,
  ) {
    setActivities((current) =>
      [
        {
          ...activity,
          id: Date.now() + Math.floor(Math.random() * 1000),

          createdAt: new Date().toISOString(),
        },

        ...current,
      ].slice(0, 30),
    );
  }

  function clearActivities() {
    setActivities([]);
  }

  function resetWorkspace() {
    setHistoryId("");
    setIdeaId("");

    setTopic("");
    setStyle("");
    setLanguage("");

    setAssetIds([]);
    setDraft({});

    setCommand(null);
    setActivities([]);
  }

  const value = useMemo<AtlasWorkspaceContextValue>(
    () => ({
      conversationId,
      historyId,
      campaignId,
      ideaId,

      topic,
      style,
      language,

      assetIds,
      draft,

      command,
      activities,

      preferredMobileTab,
      setPreferredMobileTab,

      setConversationId,
      setHistoryId,
      setCampaignId,
      setIdeaId,

      setTopic,
      setStyle,
      setLanguage,

      setAssetIds,
      setDraft,

      issueCommand,

      addActivity,
      clearActivities,

      resetWorkspace,
    }),
    [
      conversationId,
      historyId,
      campaignId,
      ideaId,

      topic,
      style,
      language,

      assetIds,
      draft,

      command,
      activities,
      preferredMobileTab,
    ],
  );

  return (
    <AtlasWorkspaceContext.Provider value={value}>
      {children}
    </AtlasWorkspaceContext.Provider>
  );
}

export function useAtlasWorkspace() {
  const context = useContext(AtlasWorkspaceContext);

  if (!context) {
    throw new Error(
      "useAtlasWorkspace must be used inside AtlasWorkspaceProvider.",
    );
  }

  return context;
}
