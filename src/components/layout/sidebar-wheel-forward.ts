"use client";

import { createElement } from "react";

/** Below this width the sidebar is a Sheet and the content scrolls under it. */
const DESKTOP_MIN_WIDTH = 768;
/** Pixels per line for WheelEvent.DOM_DELTA_LINE (Firefox with a mouse wheel). */
const LINE_HEIGHT_PX = 16;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

const SIDEBAR_WRAPPER = '[data-slot="sidebar-wrapper"]';
const SIDEBAR_CONTAINER = '[data-slot="sidebar-container"]';
const SIDEBAR_CONTENT = '[data-slot="sidebar-content"]';
const SHELL_MAIN_SCROLL = '[data-slot="shell-main-scroll"]';

/** Normalize the wheel delta to pixels so lines and pages scroll like the content column. */
export const wheelDeltaToPixels = (
  event: Pick<WheelEvent, "deltaY" | "deltaMode">,
  pageHeight: number,
) => {
  switch (event.deltaMode) {
    case DOM_DELTA_LINE:
      return event.deltaY * LINE_HEIGHT_PX;
    case DOM_DELTA_PAGE:
      return event.deltaY * pageHeight;
    default:
      return event.deltaY;
  }
};

/** Whether `element` can still scroll by `delta` pixels on its own. */
export const canScrollBy = (element: HTMLElement | null, delta: number) => {
  if (!element || delta === 0) {
    return false;
  }
  const { overflowY } = getComputedStyle(element);
  if (overflowY === "hidden" || overflowY === "clip") {
    return false;
  }
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  if (maxScrollTop <= 0) {
    return false;
  }
  return delta > 0
    ? element.scrollTop < maxScrollTop - 1
    : element.scrollTop > 0;
};

/** Attach the forwarding listener to the `sidebar-wrapper` above `marker`. */
const attachWheelForward = (marker: HTMLSpanElement | null) => {
  const wrapper = marker?.closest<HTMLElement>(SIDEBAR_WRAPPER);
  if (!wrapper) {
    return;
  }

  const handleWheel = (event: WheelEvent) => {
    if (window.innerWidth < DESKTOP_MIN_WIDTH) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(SIDEBAR_CONTAINER)) {
      return;
    }
    const mainScroll = wrapper.querySelector<HTMLElement>(SHELL_MAIN_SCROLL);
    if (!mainScroll) {
      return;
    }
    const delta = wheelDeltaToPixels(event, mainScroll.clientHeight);
    const content = target.closest<HTMLElement>(SIDEBAR_CONTENT);
    if (canScrollBy(content, delta)) {
      return;
    }
    mainScroll.scrollTop += delta;
  };

  wrapper.addEventListener("wheel", handleWheel, { passive: true });
  return () => {
    wrapper.removeEventListener("wheel", handleWheel);
  };
};

/**
 * Forward wheel events from the desktop sidebar to the shell scroller.
 *
 * Since JOR-132 the content scrolls inside `shell-main-scroll`, a sibling of
 * the sidebar, so the wheel over the sidebar reached nothing. The listener is
 * passive: when `sidebar-content` can still scroll in that direction the
 * browser scrolls it as before; otherwise the delta goes to the shell
 * scroller. Nothing happens below 768px, where the sidebar is a Sheet.
 *
 * Mount it inside `SidebarProvider`; it renders a hidden marker whose ref
 * callback finds the wrapper it belongs to and removes the listener on unmount.
 */
export const SidebarWheelForward = () =>
  createElement("span", {
    ref: attachWheelForward,
    hidden: true,
    "data-slot": "sidebar-wheel-forward",
  });
