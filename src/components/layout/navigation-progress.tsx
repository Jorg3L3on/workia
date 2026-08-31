"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { useSidebar } from "@/components/ui/sidebar";
import { chromeCopy } from "@/lib/brand/chrome-copy";

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
  const [active, setActive] = useState(false);

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

      setActive(true);
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, [isMobile, setOpenMobile]);

  useEffect(() => {
    setActive(false);
  }, [pathname]);

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
