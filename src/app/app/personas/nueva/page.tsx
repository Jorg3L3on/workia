import type { Metadata } from "next";

import { PersonForm } from "@/components/people/person-form";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { listActiveAreas, listActivePositions } from "@/lib/catalog";
import { requirePeopleCreate } from "@/lib/people/auth";
import { listActiveSites } from "@/lib/sites";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.nuevaPersona,
};

const NuevaPersonaPage = async () => {
  const session = await requirePeopleCreate();

  const [areas, positions, sites] = await Promise.all([
    listActiveAreas(session.companyId),
    listActivePositions(session.companyId),
    listActiveSites(session.companyId),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PersonForm
        areas={areas}
        mode="create"
        positions={positions}
        sites={sites}
      />
    </div>
  );
};

export default NuevaPersonaPage;
