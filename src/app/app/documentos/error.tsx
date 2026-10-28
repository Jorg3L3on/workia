"use client";

import { Button } from "@/components/ui/button";
import { EXPIRING_DOCUMENTS_COPY } from "@/lib/documents/expiring";

const DocumentosError = ({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  const handleRetry = () => {
    reset();
  };

  return (
    <div className="flex flex-col items-start gap-3" role="alert">
      <p className="text-destructive text-sm">
        {EXPIRING_DOCUMENTS_COPY.error}
      </p>
      <Button onClick={handleRetry} type="button" variant="secondary">
        Reintentar
      </Button>
    </div>
  );
};

export default DocumentosError;
