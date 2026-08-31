"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useSidebar } from "@/components/ui/sidebar";
import { chromeCopy } from "@/lib/brand/chrome-copy";

const PROGRESS_TIMEOUT_MS = 10_000;

const isModifiedClick = (event: MouseEvent) =>
  event.metaKey ||
  event.ctrlKey ||
  event.shiftKey ||
  event.altKey ||
  event.button !== 0;

export const resolveInternalNavigationHref = (
  anchor: HTMLAnchorElement,
  currentUrl: URL,
): string | null => {
  if (anchor.target && anchor.target !== "_self") {
    return null;
  }

  if (anchor.hasAttribute("download")) {
    return null;
  }

  const hrefAttr = anchor.getAttribute("href");
  if (
    !hrefAttr ||
    hrefAttr.startsWith("#") ||
    hrefAttr.startsWith("mailto:") ||
    hrefAttr.startsWith("tel:") ||
    hrefAttr.startsWith("javascript:")
  ) {
    return null;
  }

  let nextUrl: URL;
  try {
    nextUrl = new URL(anchor.href);
  } catch {
    return null;
  }

  if (nextUrl.origin !== currentUrl.origin) {
    return null;
  }

  const nextKey = `${nextUrl.pathname}${nextUrl.search}`;
  const currentKey = `${currentUrl.pathname}${currentUrl.search}`;
  if (nextKey === currentKey) {
    return null;
  }

  return nextKey;
};

export const NavigationProgress = () => {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const [originPath, setOriginPath] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const active = originPath !== null && originPath === pathname;

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (isModifiedClick(event) || event.defaultPrevented) {
        return;
      }

      const eventTarget = event.target;
      if (!(eventTarget instanceof Element)) {
        return;
      }

      const anchor = eventTarget.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const href = resolveInternalNavigationHref(
        anchor,
        new URL(window.location.href),
      );
      if (!href) {
        return;
      }

      if (isMobile && eventTarget.closest("[data-slot='sidebar']")) {
        setOpenMobile(false);
      }

      setOriginPath(pathname);

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        setOriginPath(null);
      }, PROGRESS_TIMEOUT_MS);
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [isMobile, pathname, setOpenMobile]);

  if (!active) {
    return null;
  }

  return (
    <div
      aria-label={chromeCopy.navigationProgress}
      aria-live="polite"
      className="workia-route-progress"
      data-slot="navigation-progress"
      role="progressbar"
    >
      <div className="workia-route-progress-bar" />
    </div>
  );
};
