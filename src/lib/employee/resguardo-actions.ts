"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  acceptEmployeeResguardo,
  RESGUARDO_COPY,
} from "@/lib/employee/resguardo";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";

/** Resguardo acceptance from /mi/resguardo (W2-11). */
export type AcceptResguardoState = {
  error?: string;
  acceptedId?: string;
};

const movementIdSchema = z.string().uuid();

export const acceptResguardoAction = async (
  _state: AcceptResguardoState,
  formData: FormData,
): Promise<AcceptResguardoState> => {
  // The person comes from the session; the form only names the entrega.
  const context = await requireEmployeeContext();
  const parsed = movementIdSchema.safeParse(formData.get("movementId"));

  if (!parsed.success) {
    return { error: RESGUARDO_COPY.notFound };
  }

  const result = await acceptEmployeeResguardo(context, parsed.data);

  revalidatePath("/mi");
  revalidatePath("/mi/resguardo");

  if (!result.ok) {
    return {
      error:
        result.reason === "already_accepted"
          ? RESGUARDO_COPY.alreadyAccepted
          : RESGUARDO_COPY.notFound,
    };
  }

  return { acceptedId: parsed.data };
};
