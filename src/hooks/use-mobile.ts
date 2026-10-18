import * as React from "react";

const MOBILE_BREAKPOINT = 768;

const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const subscribe = (onChange: () => void) => {
  const mediaQuery = window.matchMedia(MOBILE_QUERY);

  mediaQuery.addEventListener("change", onChange);

  return () => {
    mediaQuery.removeEventListener("change", onChange);
  };
};

const getSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;

// The server cannot know the viewport, so it renders the desktop layout.
// Hydration uses this same value and then switches to the real one, which
// keeps the first client render identical to the server HTML.
const getServerSnapshot = () => false;

export const useIsMobile = () =>
  React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
