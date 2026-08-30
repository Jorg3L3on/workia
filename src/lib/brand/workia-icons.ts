import type { Metadata } from "next";

/** Shared Workia tab / PWA icons — same mark on landing, login, and /app. */
export const workiaIcons = {
  icon: [
    { url: "/favicon.ico", sizes: "any" },
    { url: "/icon.png", type: "image/png", sizes: "32x32" },
    { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
  ],
  apple: [
    { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  ],
  shortcut: [{ url: "/favicon.ico" }],
} satisfies NonNullable<Metadata["icons"]>;
