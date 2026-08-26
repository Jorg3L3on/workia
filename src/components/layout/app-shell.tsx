"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { HomeIcon, LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

type AppShellProps = {
  children: React.ReactNode;
};

export const AppShell = ({ children }: AppShellProps) => {
  const pathname = usePathname();

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/" });
  };

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <nav className="flex items-center gap-4">
          <Link className="font-semibold tracking-tight" href="/app">
            workia
          </Link>
          <Link
            className={`text-sm ${pathname === "/app" ? "text-foreground" : "text-muted-foreground"}`}
            href="/app"
          >
            <span className="inline-flex items-center gap-1">
              <HomeIcon className="size-4" />
              Home
            </span>
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={handleSignOut} type="button">
            <LogOutIcon className="size-4" />
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
};
