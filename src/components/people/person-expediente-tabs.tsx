"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ExpedienteTab = "datos" | "contratos" | "resguardo" | "historial";

type PersonExpedienteTabsProps = {
  defaultValue: ExpedienteTab;
  datos: ReactNode;
  contratos?: ReactNode;
  resguardo?: ReactNode;
  historial?: ReactNode;
};

const chipTab =
  "max-md:border-border max-md:data-active:bg-primary/10! max-md:flex-none max-md:rounded-full max-md:border max-md:px-3 max-md:py-1 max-md:after:hidden max-md:data-active:border-transparent!";

export const PersonExpedienteTabs = ({
  defaultValue,
  datos,
  contratos,
  resguardo,
  historial,
}: PersonExpedienteTabsProps) => {
  return (
    <Tabs className="gap-4" defaultValue={defaultValue}>
      {/* Below 768px the tabs are chips that scroll sideways. */}
      <TabsList
        className="h-9 w-full [scrollbar-width:none] justify-start overflow-x-auto bg-transparent p-0 max-md:h-auto max-md:gap-2"
        variant="line"
      >
        <TabsTrigger className={chipTab} value="datos">
          Datos
        </TabsTrigger>
        {contratos ? (
          <TabsTrigger className={chipTab} value="contratos">
            Contratos
          </TabsTrigger>
        ) : null}
        {resguardo ? (
          <TabsTrigger className={chipTab} value="resguardo">
            Resguardo
          </TabsTrigger>
        ) : null}
        {historial ? (
          <TabsTrigger className={chipTab} value="historial">
            Historial
          </TabsTrigger>
        ) : null}
      </TabsList>
      <TabsContent value="datos">{datos}</TabsContent>
      {contratos ? (
        <TabsContent value="contratos">{contratos}</TabsContent>
      ) : null}
      {resguardo ? (
        <TabsContent value="resguardo">{resguardo}</TabsContent>
      ) : null}
      {historial ? (
        <TabsContent value="historial">{historial}</TabsContent>
      ) : null}
    </Tabs>
  );
};
