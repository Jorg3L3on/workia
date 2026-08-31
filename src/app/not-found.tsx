import type { Metadata } from "next";

import { CredentialError } from "@/components/errors/credential-error";
import { errorCopy, pageTitles } from "@/lib/brand/chrome-copy";

export const metadata: Metadata = {
  title: pageTitles.notFound,
};

export default function NotFound() {
  return (
    <CredentialError
      code="404"
      stamp={errorCopy.notFoundStamp}
      title={errorCopy.notFoundTitle}
      description={errorCopy.notFoundDescription}
    />
  );
}
