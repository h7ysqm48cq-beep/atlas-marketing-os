export const NOTIFICATION_TYPES_KEY = "atlas.notifications.types";

export type NotificationTypes = {
  published: boolean;
  failed: boolean;
  system: boolean;
};

export const DEFAULT_NOTIFICATION_TYPES: NotificationTypes = {
  published: true,
  failed: true,
  system: true,
};

export function readNotificationTypes(): NotificationTypes {
  try {
    const value = JSON.parse(
      localStorage.getItem(NOTIFICATION_TYPES_KEY) || "{}",
    ) as Partial<NotificationTypes>;
    return { ...DEFAULT_NOTIFICATION_TYPES, ...value };
  } catch {
    return { ...DEFAULT_NOTIFICATION_TYPES };
  }
}

export function saveNotificationTypes(next: NotificationTypes) {
  localStorage.setItem(NOTIFICATION_TYPES_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("atlas:notifications-changed"));
}
