import { notFound } from "next/navigation";

import { PersonDocumentsCard } from "@/components/documents/person-documents-card";
import { listPersonDocumentCard } from "@/lib/documents";
import { recordDeliveryAction } from "@/lib/documents/actions";
import { PERSON_DOCUMENT_CARD_COPY } from "@/lib/documents/person-card";

type PersonDocumentsLoaderProps = {
  companyId: string;
  personId: string;
  today: string;
  canManage: boolean;
};

/**
 * Loads the expediente card. A person outside the company is not found
 * (404), the same answer as the rest of the expediente. A failed read stays
 * on the card so the rest of the page remains.
 */
export const PersonDocumentsLoader = async ({
  companyId,
  personId,
  today,
  canManage,
}: PersonDocumentsLoaderProps) => {
  let view: Awaited<ReturnType<typeof listPersonDocumentCard>>;

  try {
    view = await listPersonDocumentCard(companyId, personId, today);
  } catch {
    return (
      <PersonDocumentsCard
        view={{
          state: "error",
          message: PERSON_DOCUMENT_CARD_COPY.error,
          rows: [],
        }}
      />
    );
  }

  if (!view) {
    notFound();
  }

  return (
    <PersonDocumentsCard
      canManage={canManage}
      personId={personId}
      recordAction={canManage ? recordDeliveryAction : undefined}
      today={today}
      view={view}
    />
  );
};
