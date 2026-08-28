"use client";

import * as React from "react";
import { submitSignOutForm } from "@/lib/auth/client-sign-out";

import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  AudioLinesIcon,
  BookOpenIcon,
  BotIcon,
  FrameIcon,
  GalleryVerticalEndIcon,
  MapIcon,
  PieChartIcon,
  Settings2Icon,
  TerminalIcon,
  TerminalSquareIcon,
} from "lucide-react";

const data = {
  teams: [
    {
      name: "workia",
      logo: <GalleryVerticalEndIcon className="size-4" />,
      plan: "Enterprise",
    },
    {
      name: "workia Corp.",
      logo: <AudioLinesIcon className="size-4" />,
      plan: "Startup",
    },
    {
      name: "Demo",
      logo: <TerminalIcon className="size-4" />,
      plan: "Free",
    },
  ],
  navMain: [
    {
      title: "Inicio",
      url: "/app",
      icon: <TerminalSquareIcon />,
      isActive: true,
      items: [
        { title: "Resumen", url: "/app" },
        { title: "Actividad", url: "#" },
        { title: "Preferencias", url: "#" },
      ],
    },
    {
      title: "Personas",
      url: "#",
      icon: <BotIcon />,
      items: [
        { title: "Empleados", url: "#" },
        { title: "Equipos", url: "#" },
        { title: "Organigrama", url: "#" },
      ],
    },
    {
      title: "Documentación",
      url: "#",
      icon: <BookOpenIcon />,
      items: [
        { title: "Introducción", url: "#" },
        { title: "Primeros pasos", url: "#" },
        { title: "Guías", url: "#" },
      ],
    },
    {
      title: "Configuración",
      url: "#",
      icon: <Settings2Icon />,
      items: [
        { title: "General", url: "#" },
        { title: "Equipo", url: "#" },
        { title: "Facturación", url: "#" },
      ],
    },
  ],
  projects: [
    { name: "Ingeniería", url: "#", icon: <FrameIcon /> },
    { name: "Ventas y marketing", url: "#", icon: <PieChartIcon /> },
    { name: "Operaciones", url: "#", icon: <MapIcon /> },
  ],
};

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
};

export function AppSidebar({ user, ...props }: AppSidebarProps) {
  const handleSignOut = async () => {
    await submitSignOutForm({ redirectTo: "/" });
  };

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ ...user, initials }} onSignOut={handleSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
