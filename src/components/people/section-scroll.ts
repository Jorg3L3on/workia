/** Pages under /app scroll inside the shell, not the document. */
export const scrollerOf = (element: Element) =>
  element.closest<HTMLElement>("[data-slot=shell-main-scroll]");

export const prefersReducedMotion = () =>
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * Scrolls the shell's scroller so `element` sits `offset` px under its top.
 * Smooth unless asked otherwise or the user prefers reduced motion.
 * scrollIntoView would also shift the shell's overflow-hidden wrapper once
 * the scroller reaches its end, so only the scroller moves.
 */
export const scrollToElement = (
  element: HTMLElement,
  { offset, smooth = true }: { offset: number; smooth?: boolean },
) => {
  const scroller = scrollerOf(element);
  const delta =
    element.getBoundingClientRect().top -
    (scroller?.getBoundingClientRect().top ?? 0) -
    offset;

  (scroller ?? window).scrollBy({
    top: delta,
    behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
  });
};

/** The element's CSS scroll-margin-top, so the chips and CSS agree on the gap. */
export const scrollMarginTop = (element: HTMLElement) =>
  Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 16;
