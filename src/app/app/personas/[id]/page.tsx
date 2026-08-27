import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";

import { PersonForm } from "@/components/people/person-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPersonById } from "@/lib/people";
import { requirePeopleRead } from "@/lib/people/auth";
import { formatPersonName, personStatusLabels } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type PersonaDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; saved?: string }>;
};

const PersonaDetailPage = async ({
  params,
  searchParams,
}: PersonaDetailPageProps) => {
  const session = await requirePeopleRead();
  const { id } = await params;
  const { edit, saved } = await searchParams;

  const [person, canUpdate] = await Promise.all([
    getPersonById(id),
    userHasPermission(session.user.id, "people:update"),
  ]);

  if (!person) {
    notFound();
  }

  const isEditing = edit === "1" && canUpdate;

  if (isEditing) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <PersonForm mode="edit" person={person} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="workia-pass-card space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
              Expediente mínimo
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {formatPersonName(person)}
            </h1>
            <p className="text-muted-foreground text-sm">
              Registro base para contratos y resguardo.
            </p>
          </div>
          <Badge variant={person.status === "activa" ? "default" : "secondary"}>
            {personStatusLabels[person.status]}
          </Badge>
        </div>

        {saved === "1" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
            role="status"
          >
            Cambios guardados.
          </p>
        ) : null}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Nombre(s)</dt>
            <dd className="font-medium">{person.givenName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Apellidos</dt>
            <dd className="font-medium">{person.familyName}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Correo</dt>
            <dd className="font-medium">{person.email ?? "—"}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-3 pt-1">
          {canUpdate ? (
            <Button asChild variant="outline">
              <Link href={`/app/personas/${person.id}?edit=1`}>
                <PencilIcon className="size-4" aria-hidden />
                Editar
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href="/app/personas">Volver al listado</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PersonaDetailPage;
