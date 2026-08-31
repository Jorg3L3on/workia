"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { chromeCopy } from "@/lib/brand/chrome-copy";

export const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();

  const handleToggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      aria-label={chromeCopy.themeToggle}
      className="relative"
      size="icon-sm"
      variant="ghost"
      onClick={handleToggleTheme}
      type="button"
    >
      <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  );
};
