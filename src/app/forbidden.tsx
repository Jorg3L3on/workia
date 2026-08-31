import type { Metadata } from "next";

import { CredentialError } from "@/components/errors/credential-error";
import { errorCopy, pageTitles } from "@/lib/brand/chrome-copy";

export const metadata: Metadata = {
  title: pageTitles.forbidden,
};

export default function Forbidden() {
  return (
    <CredentialError
      code="403"
      stamp={errorCopy.forbiddenStamp}
      title={errorCopy.forbiddenTitle}
      description={errorCopy.forbiddenDescription}
    />
  );
}
