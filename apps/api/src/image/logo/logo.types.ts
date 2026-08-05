cat > apps/api/src/image/logo/logo.types.ts <<'EOF'
export enum LogoPlacement {
  AUTO = "AUTO",

  TOP_LEFT = "TOP_LEFT",
  TOP_CENTER = "TOP_CENTER",
  TOP_RIGHT = "TOP_RIGHT",

  CENTER_LEFT = "CENTER_LEFT",
  CENTER = "CENTER",
  CENTER_RIGHT = "CENTER_RIGHT",

  BOTTOM_LEFT = "BOTTOM_LEFT",
  BOTTOM_CENTER = "BOTTOM_CENTER",
  BOTTOM_RIGHT = "BOTTOM_RIGHT",
}

export interface LogoOverlayOptions {
  placement: LogoPlacement;

  scale: number;

  opacity: number;

  padding: number;

  safeMargin: number;

  allowManualMove: boolean;
}

export interface ImageInfo {
  width: number;

  height: number;

  platform?: string;
}
