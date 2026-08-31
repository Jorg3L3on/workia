import type { Metadata } from "next";

import { PersonForm } from "@/components/people/person-form";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { listActiveAreas, listActivePositions } from "@/lib/catalog";
import { listActivePeopleForSelect } from "@/lib/people";
import { requirePeopleCreate } from "@/lib/people/auth";
import { listActiveSites } from "@/lib/sites";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.nuevaPersona,
};

const NuevaPersonaPage = async () => {
  await requirePeopleCreate();

  const [areas, positions, sites, managers] = await Promise.all([
    listActiveAreas(),
    listActivePositions(),
    listActiveSites(),
    listActivePeopleForSelect(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PersonForm
        areas={areas}
        managers={managers}
        mode="create"
        positions={positions}
        sites={sites}
      />
    </div>
  );
};

export default NuevaPersonaPage;
