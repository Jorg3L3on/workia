/** Shared chrome classes for the authenticated top bar on /app and /admin. */
export const SHELL_TOP_NAV_CLASS_NAME =
  "bg-background sticky top-0 z-30 backdrop-blur-md";

/**
 * Lock the authenticated shell to the viewport so the sidebar stays put
 * while only the content column scrolls.
 */
export const SHELL_VIEWPORT_CLASS_NAME =
  "h-dvh max-h-dvh min-h-0 overflow-hidden";

/** Keep the inset from growing with the page; the inner region scrolls. */
export const SHELL_INSET_CLASS_NAME = "min-h-0 overflow-hidden";

/**
 * Scroll page content under the sticky top nav, not the document. The
 * scroller spans the whole inset so the wheel works in the side margins on
 * wide viewports; the max width lives on the content column inside it.
 */
export const SHELL_MAIN_SCROLL_CLASS_NAME =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain";

/** Center page content at the same 72rem column as before, inside the scroller. */
export const SHELL_CONTENT_COLUMN_CLASS_NAME =
  "mx-auto flex w-full max-w-6xl flex-col gap-4";
