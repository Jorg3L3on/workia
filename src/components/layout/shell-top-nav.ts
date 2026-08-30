/** Shared chrome classes for the authenticated top bar on /app and /admin. */
export const SHELL_TOP_NAV_CLASS_NAME =
  "bg-background sticky top-0 z-30 backdrop-blur-md";

/**
 * Lock the authenticated shell to the viewport so the sidebar stays put
 * while only the content column scrolls.
 */
export const SHELL_VIEWPORT_CLASS_NAME =
  "h-dvh max-h-dvh min-h-0 overflow-hidden";

/** Scroll the main column, not the document. */
export const SHELL_INSET_SCROLL_CLASS_NAME = "min-h-0 overflow-y-auto";
