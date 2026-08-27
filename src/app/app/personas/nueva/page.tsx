import { PersonForm } from "@/components/people/person-form";
import { requirePeopleCreate } from "@/lib/people/auth";

export const dynamic = "force-dynamic";

const NuevaPersonaPage = async () => {
  await requirePeopleCreate();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PersonForm mode="create" />
    </div>
  );
};

export default NuevaPersonaPage;
