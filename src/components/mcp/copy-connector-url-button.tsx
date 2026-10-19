"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Copies the connector URL to paste into Claude, ChatGPT or Cursor. */
export const CopyConnectorUrlButton = ({ url }: { url: string }) => {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={url}
      type="button"
      variant="secondary"
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {copied ? "URL copiada" : "Copiar URL del conector"}
    </Button>
  );
};
