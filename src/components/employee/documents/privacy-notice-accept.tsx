"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { acceptPrivacyNoticeFromAppAction } from "@/lib/privacy/employee-actions";

/**
 * The privacy notice in force, to accept before the first upload (W2-09).
 * The text scrolls inside the card so the button stays close.
 */
export const PrivacyNoticeAccept = ({
  noticeId,
  version,
  body,
}: {
  noticeId: string;
  version: number;
  body: string;
}) => {
  const [state, action, pending] = useActionState(
    acceptPrivacyNoticeFromAppAction,
    undefined,
  );

  return (
    <section
      aria-labelledby="aviso-privacidad"
      className="workia-pass-card flex flex-col gap-3 px-5 py-4"
    >
      <h2 className="text-base font-semibold" id="aviso-privacidad">
        Aviso de privacidad (versión {version})
      </h2>
      <p className="text-muted-foreground text-sm">
        Antes de subir documentos, lee y acepta el aviso de privacidad de tu
        empresa.
      </p>
      <div
        className="bg-muted/40 max-h-64 overflow-y-auto rounded-md px-3 py-2 text-sm whitespace-pre-wrap"
        data-testid="privacy-notice-body"
        tabIndex={0}
      >
        {body}
      </div>
      <form action={action}>
        <input name="noticeId" type="hidden" value={noticeId} />
        <Button
          aria-busy={pending}
          className="min-h-11 w-full"
          disabled={pending}
          size="lg"
          type="submit"
        >
          {pending ? "Guardando…" : "Leí y acepto el aviso"}
        </Button>
      </form>
      {state?.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
    </section>
  );
};
