"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { deletePersonAction } from "@/lib/people/actions";

type DeletePersonButtonProps = {
  personId: string;
};

const DeleteSubmitButton = () => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit" variant="destructive">
      {pending ? "Borrando…" : "Borrar expediente (lógico)"}
    </Button>
  );
};

export const DeletePersonButton = ({ personId }: DeletePersonButtonProps) => {
  return (
    <form action={deletePersonAction.bind(null, personId)}>
      <DeleteSubmitButton />
    </form>
  );
};
