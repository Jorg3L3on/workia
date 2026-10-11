import { Skeleton } from "@/components/ui/skeleton";

export const HeaderSkeleton = () => (
  <div className="space-y-2" aria-hidden>
    <Skeleton className="h-3 w-20" />
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-4 w-96 max-w-full" />
  </div>
);

export const ListSkeleton = ({ rows = 8 }: { rows?: number }) => (
  <div className="space-y-2" aria-hidden>
    <Skeleton className="h-10 w-full max-w-sm" />
    {Array.from({ length: rows }, (_, index) => (
      <Skeleton className="h-12 w-full" key={index} />
    ))}
  </div>
);

export const ListPageSkeleton = ({ rows }: { rows?: number }) => (
  <div
    aria-busy="true"
    aria-label="Cargando"
    className="flex flex-col gap-6"
    role="status"
  >
    <HeaderSkeleton />
    <ListSkeleton rows={rows} />
  </div>
);

export const DashboardSkeleton = () => (
  <div
    aria-busy="true"
    aria-label="Cargando"
    className="flex flex-col gap-6"
    role="status"
  >
    <HeaderSkeleton />
    <div className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  </div>
);

export const DetailSkeleton = () => (
  <div
    aria-busy="true"
    aria-label="Cargando"
    className="mx-auto flex w-full max-w-3xl flex-col gap-4"
    role="status"
  >
    <Skeleton className="h-40 w-full" />
    <Skeleton className="h-10 w-72" />
    <Skeleton className="h-72 w-full" />
  </div>
);

export const SectionSkeleton = ({ rows = 4 }: { rows?: number }) => (
  <div aria-hidden className="space-y-2">
    {Array.from({ length: rows }, (_, index) => (
      <Skeleton className="h-12 w-full" key={index} />
    ))}
  </div>
);
