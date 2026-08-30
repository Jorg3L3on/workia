export type PersonaListRow = {
  id: string;
  name: string;
  rfc: string | null;
  status: "activa" | "baja";
  searchText: string;
};
