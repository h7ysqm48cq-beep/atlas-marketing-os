import type { Metadata } from "next";
import "./globals.css";
import { PreferencesProvider } from "@/components/preferences";

export const metadata: Metadata = {
  title: "Atlas AI Marketing Suite",
  description: "AI-powered marketing operating system",
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
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
