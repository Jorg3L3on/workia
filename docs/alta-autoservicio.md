# Alta por autoservicio (Workia 2.0 W2-10)

La persona nueva llena sus propios datos y sube sus documentos antes de su
primer día; RH revisa en vez de capturar. Vive dentro de la etapa «Captura RH»
del alta que ya existe (RH → Nóminas).

## Flujo

1. **RH** crea a la persona (nombre, CURP, puesto, sucursal, ingreso) e inicia
   su alta como siempre.
2. En el alta, la tarjeta **«Autoservicio de la persona»** da el acceso:
   - con correo: invitación por correo («Completa tu alta en Workia»), la misma
     cuenta de empleado de W2-01;
   - sin correo: un código de activación que se muestra una vez (entra con
     CURP y código en `/mi/activar`);
   - si ya tiene cuenta activa: un recordatorio por correo.

   Abrir el autoservicio pide `people:update`; crear el acceso pide además
   `employee_accounts:manage`, como en el expediente.

3. **La persona** entra a `/mi`, ve «Completa tu alta» y abre `/mi/alta`:
   datos personales, domicilio y hasta tres beneficiarios. Puede guardar y
   seguir después. Los documentos se suben en «Mis documentos» (W2-04) y RH los
   revisa en su bandeja de siempre. Antes de capturar acepta el aviso de
   privacidad vigente (W2-09).
4. **«Enviar a RH»** pide todos los campos obligatorios y bloquea el formulario.
   Cada valor pasa por las reglas del formulario de persona (RFC, NSS, CP,
   clave de elector, beneficiarios que suman 100).
5. **RH** ve en el alta lo que envió la persona junto a lo que tiene el
   expediente y:
   - **Aplicar al expediente**: los valores pasan a la persona con la edición
     de siempre (`updatePerson`: duplicados de RFC/NSS, auditoría con el antes
     y el después). Un campo vacío deja el dato que ya había.
   - **Devolver a la persona**: motivo de una lista cerrada (`incompleto`,
     `datos_incorrectos`, `identificador_duplicado`), sin texto libre.
6. El visto bueno de RH del alta espera mientras haya datos enviados sin
   decidir. Cuando el alta sale de «Captura RH» el formulario queda cerrado.

La persona nunca escribe su fila de `people`: sus valores esperan en
`onboarding_intakes.data` hasta que RH los aplica.

## Campos

| Sección       | Campos                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Personales    | teléfono, fecha de nacimiento, sexo, estado civil, estado de nacimiento, nacionalidad, RFC, NSS, clave de elector |
| Domicilio     | calle, número exterior, número interior (opcional), colonia, municipio, estado, CP                                |
| Beneficiarios | hasta 3, opcional; cuenta como un campo                                                                           |

RH conserva nombre, CURP, puesto, área, sucursal, jefe, ingreso, horario y
todo lo de nómina.

**Criterio de aceptación** (80 % de los campos los llena la persona): son 17
campos y enviar exige los 15 obligatorios, así que un alta aplicada desde
autoservicio llega al menos al 88 %. Al aplicar se guarda
`fields_by_employee` / `fields_total` y el alta lo muestra.

## Tabla (migración 0048)

`onboarding_intakes`: una fila por alta (`company_id, onboarding_id` único),
`status` `invitado` → `enviado` → `aplicado`, o `devuelto` y otra vez
`enviado`. RLS por empresa como el resto. `data` es un jsonb pequeño; no hay
archivos en Neon.

La auditoría registra nombres de campos, nunca los valores.

## Pendiente

- Aviso a RH cuando la persona envía (W2-08 notificaciones) y evento de línea
  de tiempo (W2-13) cuando esas ramas se integren.
- El checklist del alta sigue siendo de RH: no se marca solo con los
  documentos aceptados.
