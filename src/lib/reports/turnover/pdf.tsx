/**
 * The turnover dashboard as a PDF (WRK-I12-4, decision 71122458): generated
 * on the server with @react-pdf/renderer from the same report the dashboard
 * and the Excel show. Charts are redrawn with react-pdf's SVG primitives
 * (recharts only runs in the browser). Letter, portrait, Helvetica (the
 * built-in font: no font files to ship). No payroll data: the finiquito
 * total only with compensation:read, as in the Excel.
 */

import {
  Document,
  Line,
  Page,
  Polyline,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

import { formatDateMx } from "@/lib/format/date";
import { terminationClassificationLabels } from "@/lib/termination-reasons/schema";

import { MIN_GROUP_HEADCOUNT } from "./metrics";
import type { LabeledBreakdownRow, TurnoverReport } from "./report";

const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const BRAND = "#0b7fa6";
const ALERT = "#dc2626";
const BAR = "#9ca3af";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
  },
  header: { marginBottom: 14 },
  eyebrow: { fontSize: 8, color: MUTED, textTransform: "uppercase" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 2 },
  meta: { fontSize: 8, color: MUTED, marginTop: 3 },
  row: { flexDirection: "row", gap: 8 },
  card: {
    border: `1 solid ${LINE}`,
    borderRadius: 4,
    padding: 8,
    flexGrow: 1,
    flexBasis: 0,
  },
  label: { fontSize: 8, color: MUTED },
  hero: { fontSize: 28, fontFamily: "Helvetica-Bold", marginVertical: 2 },
  value: { fontSize: 14, fontFamily: "Helvetica-Bold", marginVertical: 2 },
  small: { fontSize: 7.5, color: MUTED },
  section: { marginTop: 14 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: `0.5 solid ${LINE}`,
    paddingVertical: 2.5,
  },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: MUTED },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 7,
    color: MUTED,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

const pct = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)} %`;

const plural = (count: number, one: string, many: string) =>
  `${count} ${Math.abs(count) === 1 ? one : many}`;

/** One decimal at most, as the dashboard shows it. */
const num = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const signed = (count: number) =>
  `${count > 0 ? "+" : ""}${plural(count, "baja", "bajas")}`;

const monthShort = (month: string) =>
  new Intl.DateTimeFormat("es-MX", {
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace(".", "");

const difference = (current: number | null, other: number | null) =>
  current === null || other === null
    ? "—"
    : `${current - other >= 0 ? "+" : "-"}${Math.abs(current - other).toFixed(1)} pts`;

/** Monthly bajas as bars and the rate as a line, with the goal dashed. */
const TrendChart = ({ report }: { report: TurnoverReport }) => {
  const width = 520;
  const height = 120;
  const points = report.trend;
  const step = width / points.length;
  const maxExits = Math.max(...points.map((point) => point.exits), 1);
  const maxRate = Math.max(
    ...points.map((point) => point.rate ?? 0),
    report.goal.monthly ?? 0,
    1,
  );
  const y = (rate: number) => height - (rate / maxRate) * (height - 10);
  const history = (month: string) =>
    report.historyStart !== null && month >= report.historyStart;
  const line = points
    .map((point, index) =>
      history(point.month) && point.rate !== null
        ? `${index * step + step / 2},${y(point.rate)}`
        : null,
    )
    .filter(Boolean)
    .join(" ");

  return (
    <View>
      <Svg height={height + 2} width={width}>
        <Line
          stroke={LINE}
          strokeWidth={0.5}
          x1={0}
          x2={width}
          y1={height}
          y2={height}
        />
        {points.map((point, index) => {
          const barHeight = (point.exits / maxExits) * (height - 30);

          return (
            <Rect
              fill={history(point.month) ? BAR : LINE}
              height={Math.max(barHeight, 0.5)}
              key={point.month}
              width={step * 0.55}
              x={index * step + step * 0.225}
              y={height - barHeight}
            />
          );
        })}
        {line ? (
          <Polyline
            fill="none"
            points={line}
            stroke={BRAND}
            strokeWidth={1.5}
          />
        ) : null}
        {report.goal.monthly !== null ? (
          <Line
            stroke={ALERT}
            strokeDasharray="4 3"
            strokeWidth={0.8}
            x1={0}
            x2={width}
            y1={y(report.goal.monthly)}
            y2={y(report.goal.monthly)}
          />
        ) : null}
      </Svg>
      <View style={[styles.row, { gap: 0, marginTop: 2 }]}>
        {points.map((point) => (
          <View key={point.month} style={{ width: step, alignItems: "center" }}>
            <Text style={styles.small}>{monthShort(point.month)}</Text>
            <Text style={{ fontSize: 7 }}>{point.exits}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.small, { marginTop: 3 }]}>
        Barras: bajas por mes. Línea: rotación mensual
        {report.goal.monthly !== null
          ? `. Punteada: meta ${pct(report.goal.monthly)} mensual`
          : ""}
        .
      </Text>
    </View>
  );
};

const Bars = ({
  rows,
  threshold,
}: {
  rows: { label: string; value: number; text: string; hot?: boolean }[];
  threshold?: number | null;
}) => {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <View>
      {rows.map((row) => (
        <View
          key={row.label}
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 3,
          }}
        >
          <Text style={{ width: 120 }}>{row.label}</Text>
          <View style={{ flexGrow: 1, height: 7, backgroundColor: "#f3f4f6" }}>
            <View
              style={{
                width: `${Math.max((row.value / max) * 100, 1)}%`,
                height: 7,
                backgroundColor: row.hot ? ALERT : BAR,
              }}
            />
          </View>
          <Text
            style={{
              width: 110,
              textAlign: "right",
              color: row.hot ? ALERT : INK,
            }}
          >
            {row.text}
          </Text>
        </View>
      ))}
      {threshold !== undefined ? (
        <Text style={styles.small}>
          Tasa · bajas · plantilla. Grupos con menos de {MIN_GROUP_HEADCOUNT}{" "}
          personas en «Otros».
          {threshold !== null ? ` En rojo, arriba de ${pct(threshold)}.` : ""}
        </Text>
      ) : null}
    </View>
  );
};

const breakdownRows = (rows: LabeledBreakdownRow[], threshold: number | null) =>
  rows.slice(0, 8).map((row) => ({
    label: row.label,
    value: row.exits,
    text: `${pct(row.rate)} · ${row.exits} · ${num(row.headcount)}`,
    hot: threshold !== null && row.rate !== null && row.rate > threshold,
  }));

export type TurnoverPdfContext = {
  companyName: string;
  filterText: string;
  generatedAt: string;
  generatedBy: string;
  /** Finiquito paid in the range; null without compensation:read. */
  finiquitoPaid: number | null;
};

export const TurnoverPdf = ({
  report,
  context,
}: {
  report: TurnoverReport;
  context: TurnoverPdfContext;
}) => {
  const { summary, previous, lastYear, goal, funnel } = report;
  const threshold =
    goal.forRange ?? (summary.rate === null ? null : summary.rate * 1.5);
  const aboveGoal =
    goal.forRange !== null &&
    summary.rate !== null &&
    summary.rate > goal.forRange;
  const lost = funnel.hires - (funnel.steps.at(-1)?.active ?? funnel.hires);

  return (
    <Document
      author={context.generatedBy}
      creator="Workia"
      title={`Rotación ${context.companyName} ${report.filter.from} ${report.filter.to}`}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{context.companyName} · Reportes</Text>
          <Text style={styles.title}>Rotación</Text>
          <Text style={styles.meta}>
            Periodo: {formatDateMx(report.filter.from)} –{" "}
            {formatDateMx(report.filter.to)} · Filtros:{" "}
            {context.filterText || "sin filtros"}
          </Text>
          <Text style={styles.meta}>
            Fecha de corte: {context.generatedAt} · Generado por{" "}
            {context.generatedBy}
          </Text>
        </View>

        <View style={styles.row}>
          <View style={[styles.card, { flexGrow: 1.4 }]}>
            <Text style={styles.label}>Rotación del periodo</Text>
            <Text style={[styles.hero, aboveGoal ? { color: ALERT } : {}]}>
              {pct(summary.rate)}
            </Text>
            <Text style={styles.small}>
              {plural(summary.exits, "baja", "bajas")} · plantilla promedio{" "}
              {num(summary.headcount)}
              {summary.smallSample ? " · muestra pequeña" : ""}
            </Text>
            <Text style={[styles.small, { marginTop: 4 }]}>
              vs periodo anterior: {difference(summary.rate, previous.rate)} (
              {signed(summary.exits - previous.exits)})
            </Text>
            <Text style={styles.small}>
              vs un año antes:{" "}
              {lastYear
                ? `${difference(summary.rate, lastYear.rate)} (${signed(summary.exits - lastYear.exits)})`
                : "sin historia"}
            </Text>
            {goal.forRange !== null ? (
              <Text style={[styles.small, aboveGoal ? { color: ALERT } : {}]}>
                Meta del periodo: {pct(goal.forRange)}
                {aboveGoal ? " · arriba de la meta" : ""}
              </Text>
            ) : null}
          </View>
          <View style={{ flexGrow: 2, flexBasis: 0, gap: 8 }}>
            <View style={styles.row}>
              <View style={styles.card}>
                <Text style={styles.label}>Rotación 12 meses</Text>
                <Text style={styles.value}>{pct(report.rolling.rate)}</Text>
                <Text style={styles.small}>
                  {report.rolling.estimated
                    ? `Estimada con ${report.rolling.months} meses`
                    : "Últimos 12 meses"}
                </Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.label}>Bajas en prueba (90 días)</Text>
                <Text style={styles.value}>{pct(summary.trial.share)}</Text>
                <Text style={styles.small}>
                  {summary.trial.exits} de {summary.trial.exitsWithIngreso}{" "}
                  bajas
                </Text>
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.card}>
                <Text style={styles.label}>Voluntaria / involuntaria</Text>
                <Text style={styles.value}>
                  {pct(summary.byClass.voluntaria.rate)} /{" "}
                  {pct(summary.byClass.involuntaria.rate)}
                </Text>
                <Text style={styles.small}>
                  {summary.byClass.voluntaria.exits} voluntarias ·{" "}
                  {summary.byClass.involuntaria.exits} involuntarias
                </Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.label}>Plantilla promedio</Text>
                <Text style={styles.value}>{num(summary.headcount)}</Text>
                <Text style={styles.small}>
                  {summary.hires} ingresos · {summary.reentries.count}{" "}
                  reingresos
                  {context.finiquitoPaid !== null
                    ? ` · finiquito pagado $${context.finiquitoPaid.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`
                    : ""}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tendencia (últimos 12 meses)</Text>
          <TrendChart report={report} />
        </View>

        <View style={[styles.section, styles.row, { gap: 16 }]}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.sectionTitle}>Prueba de 90 días</Text>
            <Text style={{ marginBottom: 6 }}>
              {funnel.hires === 0
                ? "No hay ingresos del periodo que ya cumplieran 90 días."
                : `De ${plural(funnel.hires, "ingreso", "ingresos")}, ${lost === 0 ? "nadie se fue" : `${lost} se ${lost === 1 ? "fue" : "fueron"}`} antes del día 90${
                    funnel.biggestDrop && lost > 0
                      ? `; la mayor caída es ${funnel.biggestDrop.from === 0 ? "en los primeros 30 días" : `entre el día ${funnel.biggestDrop.from} y ${funnel.biggestDrop.to}`}`
                      : ""
                  }.`}
            </Text>
            {funnel.hires > 0 ? (
              <Bars
                rows={[
                  {
                    label: "Ingresos",
                    value: funnel.hires,
                    text: String(funnel.hires),
                  },
                  ...funnel.steps.map((step) => ({
                    label: `Día ${step.days}`,
                    value: step.active,
                    text: `${step.active} (${pct((step.active / funnel.hires) * 100)})`,
                  })),
                ]}
              />
            ) : null}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.sectionTitle}>Por área</Text>
            {report.breakdowns.area.length === 0 ? (
              <Text style={styles.small}>Sin bajas ni plantilla.</Text>
            ) : (
              <Bars
                rows={breakdownRows(report.breakdowns.area, threshold)}
                threshold={threshold}
              />
            )}
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Workia · Reporte de rotación</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Página ${pageNumber} de ${totalPages}`
            }
          />
        </View>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View style={[styles.row, { gap: 16 }]}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.sectionTitle}>Por motivo</Text>
            <View style={styles.tableRow}>
              <Text style={[styles.th, { width: "55%" }]}>Motivo</Text>
              <Text style={[styles.th, { width: "25%" }]}>Clasificación</Text>
              <Text style={[styles.th, { width: "20%", textAlign: "right" }]}>
                Bajas
              </Text>
            </View>
            {report.reasons.length === 0 ? (
              <Text style={[styles.small, { marginTop: 4 }]}>
                Sin bajas en el periodo.
              </Text>
            ) : (
              report.reasons.map((reason) => (
                <View key={reason.motivoId ?? "none"} style={styles.tableRow}>
                  <Text style={{ width: "55%" }}>
                    {reason.name ?? "Sin motivo"}
                  </Text>
                  <Text style={{ width: "25%" }}>
                    {terminationClassificationLabels[reason.classification]}
                  </Text>
                  <Text style={{ width: "20%", textAlign: "right" }}>
                    {reason.exits} ({pct(reason.share)})
                  </Text>
                </View>
              ))
            )}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 0 }}>
            <Text style={styles.sectionTitle}>Por sucursal</Text>
            {report.breakdowns.site.length === 0 ? (
              <Text style={styles.small}>Sin bajas ni plantilla.</Text>
            ) : (
              <Bars
                rows={breakdownRows(report.breakdowns.site, threshold)}
                threshold={threshold}
              />
            )}
            <Text style={[styles.sectionTitle, { marginTop: 12 }]}>
              Por jefe directo
            </Text>
            {report.breakdowns.manager.length === 0 ? (
              <Text style={styles.small}>Sin bajas ni plantilla.</Text>
            ) : (
              <Bars
                rows={breakdownRows(report.breakdowns.manager, threshold)}
                threshold={threshold}
              />
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Cohortes: retención al día 30, 60 y 90
          </Text>
          <View style={styles.tableRow}>
            {["Mes de ingreso", "Ingresos", "Día 30", "Día 60", "Día 90"].map(
              (header) => (
                <Text key={header} style={[styles.th, { width: "20%" }]}>
                  {header}
                </Text>
              ),
            )}
          </View>
          {report.cohorts
            .filter((row) => row.hires > 0)
            .map((row) => (
              <View key={row.month} style={styles.tableRow}>
                <Text style={{ width: "20%" }}>
                  {monthShort(row.month)} {row.month.slice(0, 4)}
                </Text>
                <Text style={{ width: "20%" }}>{row.hires}</Text>
                {row.cells.map((cell) => (
                  <Text key={cell.days} style={{ width: "20%" }}>
                    {!cell.mature
                      ? "en curso"
                      : row.smallSample
                        ? `${cell.retained}/${row.hires}`
                        : pct(cell.rate)}
                  </Text>
                ))}
              </View>
            ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cómo se calcula</Text>
          {[
            "Rotación = bajas del periodo / plantilla promedio × 100. Nunca suma ni promedio de tasas mensuales.",
            "Plantilla del mes = (activos el día 1 + activos al cierre del último día) / 2; varios meses, el promedio de las plantillas mensuales.",
            "Una baja es un periodo laboral con fecha de baja en el rango; las bajas sin fecha no cuentan.",
            "Voluntaria / involuntaria según la clasificación actual del motivo; sin motivo, según el tipo de baja.",
            "Salida en prueba: baja en o antes del día 90 de su periodo (el ingreso es el día 1).",
          ].map((line) => (
            <Text key={line} style={{ marginBottom: 2 }}>
              · {line}
            </Text>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>Workia · Reporte de rotación</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Página ${pageNumber} de ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
};

/** The PDF file of the report. */
export const renderTurnoverPdf = (
  report: TurnoverReport,
  context: TurnoverPdfContext,
) => renderToBuffer(<TurnoverPdf context={context} report={report} />);
