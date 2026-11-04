"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { OptionalNotificationChannel } from "@/lib/db/schema";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { requireCompanyContext } from "@/lib/tenant/context";

import {
  markAllNotificationsRead,
  markNotificationRead,
  personRecipient,
  setChannelEnabled,
  userRecipient,
} from "./index";
import { INBOX_PATH } from "./templates";

/**
 * Inbox actions of both apps (W2-08). The recipient always comes from the
 * session (the employee's person, or the HR user in their active company),
 * never from the form; an id of someone else's message does nothing.
 */

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const channelOf = (formData: FormData): OptionalNotificationChannel | null => {
  const channel = text(formData, "channel");

  return channel === "email" || channel === "push" ? channel : null;
};

// ── Employee app (/mi/avisos) ────────────────────────────────────────────

export const openEmployeeNotificationAction = async (formData: FormData) => {
  const context = await requireEmployeeContext();
  const opened = await markNotificationRead(
    context.companyId,
    personRecipient(context.personId),
    text(formData, "id"),
  );

  revalidatePath("/mi", "layout");
  redirect(opened?.url ?? INBOX_PATH.person);
};

export const markAllEmployeeNotificationsReadAction = async () => {
  const context = await requireEmployeeContext();

  await markAllNotificationsRead(
    context.companyId,
    personRecipient(context.personId),
  );
  revalidatePath("/mi", "layout");
};

export const setEmployeeChannelAction = async (formData: FormData) => {
  const context = await requireEmployeeContext();
  const channel = channelOf(formData);

  if (!channel) {
    return;
  }

  await setChannelEnabled(
    context.companyId,
    personRecipient(context.personId),
    channel,
    text(formData, "enabled") === "1",
  );
  revalidatePath(INBOX_PATH.person);
};

// ── HR app (/app/avisos) ─────────────────────────────────────────────────

export const openUserNotificationAction = async (formData: FormData) => {
  const session = await requireCompanyContext();
  const opened = await markNotificationRead(
    session.companyId,
    userRecipient(session.userId),
    text(formData, "id"),
  );

  revalidatePath("/app", "layout");
  redirect(opened?.url ?? INBOX_PATH.user);
};

export const markAllUserNotificationsReadAction = async () => {
  const session = await requireCompanyContext();

  await markAllNotificationsRead(
    session.companyId,
    userRecipient(session.userId),
  );
  revalidatePath("/app", "layout");
};

export const setUserEmailChannelAction = async (formData: FormData) => {
  const session = await requireCompanyContext();

  await setChannelEnabled(
    session.companyId,
    userRecipient(session.userId),
    "email",
    text(formData, "enabled") === "1",
  );
  revalidatePath(INBOX_PATH.user);
};
