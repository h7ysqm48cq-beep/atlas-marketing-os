import type { Metadata } from "next";
import "./globals.css";
import "./sidebar-enhancements.css";
import "./workspace-compact.css";
import "./asset-library-mobile-v3.css";
import { PreferencesProvider } from "@/components/preferences";
import { PwaRegister } from "@/components/PwaRegister";
import { PwaStandalone } from "@/components/PwaStandalone";

export const metadata: Metadata = {
  title: {
    default: "Atlas AI Marketing Suite",
    template: "%s | Atlas",
  },
  applicationName: "Atlas AI Marketing Suite",
  description: "AI-powered marketing operating system",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Atlas",
    startupImage: [
      {
        url: "/splash/iphone-15-pro-max.png",
        media:
          "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/iphone-15-pro.png",
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/iphone-14.png",
        media:
          "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/iphone-13-pro-max.png",
        media:
          "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/iphone-x.png",
        media:
          "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)",
      },
    ],
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const raw = localStorage.getItem(
                  "atlas.interface.preferences"
                );
                const saved = raw ? JSON.parse(raw) : {};
                const language =
                  saved.language === "zh" ? "zh" : "en";
                const preference =
                  ["dark", "light", "system"].includes(
                    saved.theme
                  )
                    ? saved.theme
                    : "dark";
                const resolved =
                  preference === "system"
                    ? (
                        matchMedia(
                          "(prefers-color-scheme: light)"
                        ).matches
                          ? "light"
                          : "dark"
                      )
                    : preference;

                document.documentElement.lang =
                  language === "zh" ? "zh-CN" : "en";
                document.documentElement.dataset.theme =
                  resolved;
                document.documentElement.dataset
                  .themePreference = preference;
              } catch {
                document.documentElement.dataset.theme =
                  "dark";
              }
            `,
          }}
        />
      </head>

      <body>
        <PwaRegister />
        <PwaStandalone />
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
