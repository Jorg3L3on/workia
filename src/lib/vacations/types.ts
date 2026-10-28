/** A period slice the ledger uses to place a range in a service year. */
export type VacationPeriodSlice = {
  id: string;
  fechaIngreso: string | null;
  fechaBaja: string | null;
  bajaSinFecha: boolean;
  reconoceAntiguedad: boolean;
  fechaAntiguedadReconocida: string | null;
};

/** One stored range. Voided rows stay in the table and drop out of the balance. */
export type VacationSpan = {
  startDate: string;
  endDate: string;
  serviceYear: number;
  days: string | number;
  voided: boolean;
};

export type VacationActionState = {
  ok?: boolean;
  error?: string;
  warning?: string;
};

export type VacationHistoryItem = {
  id: string;
  startDate: string;
  endDate: string;
  days: string;
  serviceYear: number;
  note: string | null;
  createdByName: string | null;
};
