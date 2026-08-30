export type PersonaListRow = {
  id: string;
  name: string;
  rfc: string | null;
  status: "activa" | "baja";
  deleted: boolean;
  searchText: string;
};
