import { ExpiringDocumentsTray } from "@/components/documents/expiring-documents-tray";
import { listActivePositions } from "@/lib/catalog";
import { listExpiringDocuments } from "@/lib/documents";
import type { ExpiringDocumentStatus } from "@/lib/documents/expiring";

type ExpiringDocumentsLoaderProps = {
  companyId: string;
  today: string;
  positionId?: string;
  status: ExpiringDocumentStatus;
};

/**
 * Loads the tray. A failed read stays on the page as an error so the shell
 * remains. The company comes from the session, never from the query string.
 */
export const ExpiringDocumentsLoader = async ({
  companyId,
  today,
  positionId,
  status,
}: ExpiringDocumentsLoaderProps) => {
  let items: Awaited<ReturnType<typeof listExpiringDocuments>> = [];
  let positions: { id: string; name: string }[] = [];
  let knownPosition = "";
  let failed = false;

  try {
    const loaded = await listActivePositions(companyId);
    knownPosition = loaded.some((position) => position.id === positionId)
      ? (positionId ?? "")
      : "";
    positions = loaded.map((position) => ({
      id: position.id,
      name: position.name,
    }));
    items = await listExpiringDocuments(companyId, today, {
      positionId: knownPosition || undefined,
      status,
    });
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <ExpiringDocumentsTray
        error
        items={[]}
        positionId=""
        positions={[]}
        status={status}
      />
    );
  }

  return (
    <ExpiringDocumentsTray
      items={items}
      positionId={knownPosition}
      positions={positions}
      status={status}
    />
  );
};
