import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { chromeCopy } from "@/lib/brand/chrome-copy";

const { navigationState, mobileState } = vi.hoisted(() => ({
  navigationState: { pathname: "/app" },
  mobileState: { isMobile: false },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.isMobile,
}));

import {
  NavigationProgress,
  resolveInternalNavigationHref,
} from "@/components/layout/navigation-progress";

const ProgressHarness = ({ children }: { children?: ReactNode }) => (
  <SidebarProvider>
    <NavigationProgress />
    {children}
  </SidebarProvider>
);

const renderProgress = (markup?: ReactNode) =>
  render(<ProgressHarness>{markup}</ProgressHarness>);

afterEach(() => {
  navigationState.pathname = "/app";
  mobileState.isMobile = false;
  cleanup();
});

const setCurrentPath = (path: string) => {
  window.history.pushState({}, "", path);
};

describe("resolveInternalNavigationHref", () => {
  const currentUrl = new URL("http://localhost:3000/app");

  const createAnchor = (attributes: Record<string, string>) => {
    const anchor = document.createElement("a");
    for (const [name, value] of Object.entries(attributes)) {
      anchor.setAttribute(name, value);
    }
    return anchor;
  };

  it("accepts same-origin destination links", () => {
    expect(
      resolveInternalNavigationHref(
        createAnchor({ href: "/app/personas" }),
        currentUrl,
      ),
    ).toBe("/app/personas");
  });

  it("ignores the current route, hashes, downloads and external links", () => {
    expect(
      resolveInternalNavigationHref(createAnchor({ href: "/app" }), currentUrl),
    ).toBeNull();
    expect(
      resolveInternalNavigationHref(
        createAnchor({ href: "#contenido" }),
        currentUrl,
      ),
    ).toBeNull();
    expect(
      resolveInternalNavigationHref(
        createAnchor({ href: "/app/personas", download: "" }),
        currentUrl,
      ),
    ).toBeNull();
    expect(
      resolveInternalNavigationHref(
        createAnchor({ href: "https://example.com/app/personas" }),
        currentUrl,
      ),
    ).toBeNull();
  });
});

describe("NavigationProgress", () => {
  it("shows the top loader on an internal destination click and hides it after the route changes", () => {
    setCurrentPath("/app");
    const { rerender } = renderProgress(
      <a href="/app/personas" data-slot="sidebar">
        Personas
      </a>,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Personas" }));

    expect(
      screen.getByRole("progressbar", {
        name: chromeCopy.navigationProgress,
      }),
    ).toBeTruthy();

    navigationState.pathname = "/app/personas";
    rerender(
      <ProgressHarness>
        <a href="/app/personas" data-slot="sidebar">
          Personas
        </a>
      </ProgressHarness>,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("does not start for the current page", () => {
    setCurrentPath("/app");
    renderProgress(<a href="/app">Inicio</a>);

    fireEvent.click(screen.getByRole("link", { name: "Inicio" }));

    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
