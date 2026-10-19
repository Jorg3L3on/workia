"use client";

import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export const PrintButton = () => (
  <Button onClick={() => window.print()} type="button" variant="secondary">
    <PrinterIcon className="size-4" aria-hidden />
    Imprimir
  </Button>
);
