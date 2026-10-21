import type { Onboarding } from "@/lib/db/schema";

/**
 * Whether an alta keeps a person from starting another one (Iniciativa 2),
 * given the id of the person's open employment period and how many periods
 * they have: the same rule as findBlockingOnboarding, for lists.
 */
export const blocksNewOnboarding = (
  onboarding: Pick<Onboarding, "employmentPeriodId" | "stage">,
  openPeriod: { id: string; periodCount: number } | null,
) => {
  if (!openPeriod) {
    return true;
  }

  return (
    onboarding.employmentPeriodId === openPeriod.id ||
    onboarding.stage === "rh_captura" ||
    onboarding.stage === "pendiente_nominas" ||
    (onboarding.employmentPeriodId === null && openPeriod.periodCount === 1)
  );
};
