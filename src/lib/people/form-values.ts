import type { PersonWithRelations as MaybePerson } from "./index";
import type { PersonFormValues } from "./schema";

type PersonWithRelations = NonNullable<MaybePerson>;

/** The whole form as the app would submit it, from the person as stored. */
export const personFormFromRecord = (
  person: PersonWithRelations,
): PersonFormValues => ({
  nombres: person.nombres,
  apellidoPaterno: person.apellidoPaterno,
  apellidoMaterno: person.apellidoMaterno ?? "",
  email: person.email ?? "",
  telefono: person.telefono ?? "",
  fechaNacimiento: person.fechaNacimiento ?? "",
  fechaIngreso: person.fechaIngreso ?? "",
  areaId: person.areaId ?? "",
  positionId: person.positionId ?? "",
  managerId: person.managerId ?? "",
  siteId: person.siteId ?? "",
  rfc: person.rfc ?? "",
  curp: person.curp ?? "",
  nss: person.nss ?? "",
  horarioEntrada: person.schedule?.entrada ?? "",
  horarioSalidaComer: person.schedule?.salidaComer ?? "",
  horarioRegresoComer: person.schedule?.regresoComer ?? "",
  horarioSalida: person.schedule?.salida ?? "",
  status: person.status,
  domicilioCalle: person.domicilioCalle ?? "",
  domicilioNumeroExterior: person.domicilioNumeroExterior ?? "",
  domicilioNumeroInterior: person.domicilioNumeroInterior ?? "",
  domicilioColonia: person.domicilioColonia ?? "",
  domicilioMunicipio: person.domicilioMunicipio ?? "",
  domicilioEstado: (person.domicilioEstado ??
    "") as PersonFormValues["domicilioEstado"],
  domicilioCodigoPostal: person.domicilioCodigoPostal ?? "",
  estadoCivil: person.estadoCivil ?? "",
  sexo: person.sexo ?? "",
  lugarNacimiento: (person.lugarNacimiento ??
    "") as PersonFormValues["lugarNacimiento"],
  nacionalidad: person.nacionalidad ?? "",
  ineClaveElector: person.ineClaveElector ?? "",
});
