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

export const PersonExpedienteTabs = ({
  defaultValue,
  datos,
  contratos,
  resguardo,
  historial,
}: PersonExpedienteTabsProps) => {
  return (
    <Tabs className="gap-4" defaultValue={defaultValue}>
      <TabsList
        className="h-9 w-full justify-start bg-transparent p-0"
        variant="line"
      >
        <TabsTrigger value="datos">Datos</TabsTrigger>
        {contratos ? (
          <TabsTrigger value="contratos">Contratos</TabsTrigger>
        ) : null}
        {resguardo ? (
          <TabsTrigger value="resguardo">Resguardo</TabsTrigger>
        ) : null}
        {historial ? (
          <TabsTrigger value="historial">Historial</TabsTrigger>
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
