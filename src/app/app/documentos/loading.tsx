import { ListPageSkeleton } from "@/components/loading/page-skeletons";
import { EXPIRING_DOCUMENTS_COPY } from "@/lib/documents/expiring";

const Loading = () => (
  <div
    aria-busy="true"
    aria-label={EXPIRING_DOCUMENTS_COPY.loading}
    role="status"
  >
    <ListPageSkeleton />
  </div>
);

export default Loading;
