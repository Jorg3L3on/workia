"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ImportFileError,
  parseImportFile,
  parseSheet,
  type ParsedImportFile,
} from "@/lib/import/client";
import { IMPORT_LIMITS, type ImportSheetKey } from "@/lib/import/format";
import { uploadParsedFile } from "@/lib/import/upload";

import {
  ApiError,
  getJob,
  pauseApply,
  runApply,
  runValidation,
  updateOptions,
  type JobSummary,
} from "./import-api";
import {
  ImportMapping,
  duplicateTargets,
  missingRequired,
} from "./import-mapping";
import { ImportReview } from "./import-review";

type Step = "upload" | "map" | "review" | "confirm" | "progress" | "result";

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Archivo" },
  { key: "map", label: "Columnas" },
  { key: "review", label: "Revisión" },
  { key: "confirm", label: "Confirmar" },
  { key: "progress", label: "Progreso" },
  { key: "result", label: "Resultado" },
];

type Props = {
  /** Resume an existing import (history → Continuar). */
  initialJob: JobSummary | null;
};

const stepForJob = (job: JobSummary): Step => {
  switch (job.status) {
    case "in_review":
      return "review";
    case "validating":
    case "applying":
    case "failed":
      return "progress";
    case "applied":
    case "undone":
      return "result";
    default:
      return "upload";
  }
};

const Stepper = ({ current }: { current: Step }) => (
  <ol
    aria-label="Pasos de la importación"
    className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
  >
    {STEPS.map((step, index) => {
      const active = step.key === current;

      return (
        <li
          aria-current={active ? "step" : undefined}
          className={
            active ? "text-foreground font-semibold" : "text-muted-foreground"
          }
          key={step.key}
        >
          {index + 1}. {step.label}
        </li>
      );
    })}
  </ol>
);

export const ImportWizard = ({ initialJob }: Props) => {
  const [step, setStep] = useState<Step>(
    initialJob ? stepForJob(initialJob) : "upload",
  );
  const [job, setJob] = useState<JobSummary | null>(initialJob);
  const [parsed, setParsed] = useState<ParsedImportFile | null>(null);
  const [mappings, setMappings] = useState<
    Partial<Record<ImportSheetKey, Record<number, string>>>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<
    { id: string; status: string; createdAt: string }[]
  >([]);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [createCatalogs, setCreateCatalogs] = useState(
    initialJob?.options.createMissingCatalogs ?? false,
  );
  const [mode, setMode] = useState<"all_or_nothing" | "valid_only">(
    initialJob?.options.mode ?? "valid_only",
  );
  const abort = useRef<AbortController | null>(null);

  const refreshJob = useCallback(async (jobId: string) => {
    const next = await getJob(jobId);

    setJob(next);

    return next;
  }, []);

  const fail = (cause: unknown) => {
    if ((cause as Error).name === "AbortError") return;

    setError(
      cause instanceof ImportFileError || cause instanceof ApiError
        ? cause.message
        : "Algo salió mal. Intenta de nuevo.",
    );
  };

  const validate = useCallback(
    async (jobId: string) => {
      setBusy("Validando filas…");
      setProgress(null);

      let total = 0;

      await runValidation(jobId, (stepInfo) => {
        total = Math.max(total, stepInfo.remaining);
        setProgress({ done: total - stepInfo.remaining, total });
      });

      await refreshJob(jobId);
      setReviewVersion((version) => version + 1);
      setStep("review");
    },
    [refreshJob],
  );

  const apply = useCallback(
    async (jobId: string, expected: number) => {
      setStep("progress");
      setBusy("Aplicando cambios…");
      abort.current = new AbortController();

      let validationTotal = 0;

      try {
        await runApply(
          jobId,
          (stepInfo) => {
            // "Todo o nada" validates the whole file again before applying.
            if (stepInfo.phase === "validating") {
              validationTotal = Math.max(validationTotal, stepInfo.remaining);
              setBusy("Validando de nuevo antes de aplicar…");
              setProgress({
                done: validationTotal - stepInfo.remaining,
                total: validationTotal,
              });
              return;
            }

            setBusy("Aplicando cambios…");
            setProgress({
              done: stepInfo.applied,
              total: Math.max(expected, stepInfo.applied),
            });
          },
          abort.current.signal,
        );
        await refreshJob(jobId);
        setStep("result");
      } catch (cause) {
        // The job keeps its progress: "Continuar" resumes from the next batch.
        await refreshJob(jobId).catch(() => undefined);
        fail(cause);
      } finally {
        setBusy(null);
      }
    },
    [refreshJob],
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;

    setError(null);
    setBusy("Leyendo archivo…");

    try {
      // Loaded on demand so the reader stays out of the main bundle.
      const { readWorkbookInBrowser } =
        await import("@/lib/import/read-browser");
      const result = await parseImportFile(file, readWorkbookInBrowser);

      setParsed(result);
      setMappings(
        Object.fromEntries(
          result.sheets.map((sheet) => [sheet.sheet, sheet.mapping.mapped]),
        ),
      );
      setStep("map");
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };

  const changeMapping = (
    sheet: ImportSheetKey,
    position: number,
    columnKey: string,
  ) => {
    if (!parsed) return;

    const next = { ...(mappings[sheet] ?? {}) };

    if (columnKey === "") delete next[position];
    else next[position] = columnKey;

    const current = parsed.sheets.find(
      (candidate) => candidate.sheet === sheet,
    )!;
    const reparsed = parseSheet(sheet, current.raw, next);

    setMappings({ ...mappings, [sheet]: next });
    setParsed({
      ...parsed,
      sheets: parsed.sheets.map((candidate) =>
        candidate.sheet === sheet
          ? { ...reparsed, mapping: current.mapping }
          : candidate,
      ),
      totalRows: parsed.sheets.reduce(
        (sum, candidate) =>
          sum +
          (candidate.sheet === sheet
            ? reparsed.rows.length
            : candidate.rows.length),
        0,
      ),
    });
  };

  const mappingProblems =
    parsed?.sheets.some((sheet) => {
      const mapped = mappings[sheet.sheet] ?? sheet.mapping.mapped;

      return (
        missingRequired(sheet.sheet, mapped).length > 0 ||
        duplicateTargets(mapped).size > 0
      );
    }) ?? false;

  const upload = async () => {
    if (!parsed) return;

    setError(null);
    setBusy("Subiendo filas…");

    try {
      const result = await uploadParsedFile(parsed, {
        onProgress: ({ sentRows, totalRows }) =>
          setProgress({ done: sentRows, total: totalRows }),
      });

      setPrevious(result.previous);
      await validate(result.jobId);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const revalidate = async () => {
    if (!job) return;

    setError(null);

    try {
      await updateOptions(job.id, {
        createMissingCatalogs: createCatalogs,
        mode,
      });
      await validate(job.id);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const counts = job?.counts ?? {};
  const toApply = (counts.create ?? 0) + (counts.update ?? 0);
  const errors = counts.error ?? 0;
  const optionsChanged =
    job !== null &&
    (createCatalogs !== (job.options.createMissingCatalogs ?? false) ||
      mode !== (job.options.mode ?? "valid_only"));
  const blockedByErrors = mode === "all_or_nothing" && errors > 0;

  return (
    <div className="flex flex-col gap-6">
      <Stepper current={step} />

      {error ? (
        <div
          className="border-destructive/30 text-destructive rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div aria-live="polite" className="text-muted-foreground min-h-5 text-sm">
        {busy}
        {busy && progress
          ? ` ${progress.done.toLocaleString("es-MX")} de ${progress.total.toLocaleString("es-MX")}`
          : null}
      </div>
      {busy && progress && progress.total > 0 ? (
        <div
          aria-label="Progreso"
          aria-valuemax={progress.total}
          aria-valuemin={0}
          aria-valuenow={progress.done}
          className="bg-muted h-2 overflow-hidden rounded-full"
          role="progressbar"
        >
          <div
            className="bg-primary h-full transition-all"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      ) : null}

      {step === "upload" ? (
        <section className="flex flex-col gap-4" aria-labelledby="upload-title">
          <h2 className="text-lg font-semibold" id="upload-title">
            Sube el archivo de personas
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm">
            Usa la plantilla de Workia (.xlsx) o un .csv con la hoja Personas.
            Máximo {IMPORT_LIMITS.maxRows.toLocaleString("es-MX")} personas y{" "}
            {IMPORT_LIMITS.maxFileBytes / (1024 * 1024)} MB. Antes de aplicar
            nada verás una revisión fila por fila.
          </p>
          {initialJob?.status === "uploading" ? (
            <p className="text-sm">
              Esta importación no terminó de subirse. Vuelve a elegir el archivo
              para empezar otra.
            </p>
          ) : null}
          <label
            className="border-input hover:bg-muted/50 focus-within:ring-ring/50 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center focus-within:ring-3"
            htmlFor="import-file"
          >
            <UploadIcon aria-hidden className="size-6" />
            <span className="font-medium">Elegir archivo</span>
            <span className="text-muted-foreground text-sm">.xlsx o .csv</span>
            <input
              accept=".xlsx,.csv"
              className="sr-only"
              disabled={busy !== null}
              id="import-file"
              onChange={(event) => void onFile(event.target.files?.[0])}
              type="file"
            />
          </label>
          <p className="text-sm">
            ¿No tienes la plantilla?{" "}
            <a
              className="text-primary underline underline-offset-4"
              download
              href="/app/personas/plantilla"
            >
              Descárgala aquí
            </a>
            .
          </p>
        </section>
      ) : null}

      {step === "map" && parsed ? (
        <section className="flex flex-col gap-4" aria-labelledby="map-title">
          <h2 className="text-lg font-semibold" id="map-title">
            Revisa las columnas
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm">
            {parsed.fileName}: {parsed.totalRows.toLocaleString("es-MX")} filas.
            Propusimos el campo de cada columna; corrígelo si hace falta.
          </p>
          <ImportMapping
            mappings={mappings}
            onChange={changeMapping}
            sheets={parsed.sheets}
          />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setParsed(null);
                setStep("upload");
              }}
              type="button"
              variant="secondary"
            >
              Elegir otro archivo
            </Button>
            <Button
              disabled={mappingProblems || busy !== null}
              onClick={() => void upload()}
              type="button"
            >
              Subir y revisar
            </Button>
          </div>
        </section>
      ) : null}

      {step === "review" && job ? (
        <section className="flex flex-col gap-4" aria-labelledby="review-title">
          <h2 className="text-lg font-semibold" id="review-title">
            Revisa antes de aplicar
          </h2>
          {previous.length > 0 ? (
            <p className="bg-card ring-foreground/10 rounded-lg p-3 text-sm ring-1">
              Este mismo archivo ya se subió antes ({previous.length}{" "}
              {previous.length === 1 ? "vez" : "veces"}, la última el{" "}
              {new Date(previous[0].createdAt).toLocaleDateString("es-MX")}).
              Revisa el historial para no duplicar trabajo.
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Opciones</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={createCatalogs}
                onChange={(event) => setCreateCatalogs(event.target.checked)}
                type="checkbox"
              />
              Crear áreas, puestos y sucursales que no existan
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={mode === "valid_only"}
                name="mode"
                onChange={() => setMode("valid_only")}
                type="radio"
              />
              Aplicar solo las filas válidas
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={mode === "all_or_nothing"}
                name="mode"
                onChange={() => setMode("all_or_nothing")}
                type="radio"
              />
              Todo o nada: si hay errores no se aplica nada
            </label>
            {optionsChanged ? (
              <div>
                <Button
                  disabled={busy !== null}
                  onClick={() => void revalidate()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Volver a validar con estas opciones
                </Button>
              </div>
            ) : null}
          </fieldset>

          <ImportReview job={job} version={reviewVersion} />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={optionsChanged || toApply === 0 || blockedByErrors}
              onClick={() => setStep("confirm")}
              type="button"
            >
              Continuar
            </Button>
            {blockedByErrors ? (
              <span className="text-destructive text-sm">
                Con “todo o nada” no puede haber errores.
              </span>
            ) : toApply === 0 ? (
              <span className="text-muted-foreground text-sm">
                No hay filas para crear o actualizar.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === "confirm" && job ? (
        <section
          className="flex flex-col gap-4"
          aria-labelledby="confirm-title"
        >
          <h2 className="text-lg font-semibold" id="confirm-title">
            Confirmar importación
          </h2>
          <ul className="list-disc pl-5 text-sm">
            <li>
              {(counts.create ?? 0).toLocaleString("es-MX")} registros nuevos
            </li>
            <li>
              {(counts.update ?? 0).toLocaleString("es-MX")} registros
              actualizados
            </li>
            <li>
              {(counts.unchanged ?? 0).toLocaleString("es-MX")} sin cambios
            </li>
            <li>
              {errors.toLocaleString("es-MX")} con errores (no se aplican)
            </li>
          </ul>
          <p className="text-muted-foreground max-w-prose text-sm">
            Puedes deshacer esta importación desde el historial mientras nadie
            haya editado esos registros.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => setStep("review")}
              type="button"
              variant="secondary"
            >
              Volver a la revisión
            </Button>
            <Button onClick={() => void apply(job.id, toApply)} type="button">
              Aplicar importación
            </Button>
          </div>
        </section>
      ) : null}

      {step === "progress" && job ? (
        <section
          className="flex flex-col gap-4"
          aria-labelledby="progress-title"
        >
          <h2 className="text-lg font-semibold" id="progress-title">
            {job.status === "validating"
              ? "Validación pendiente"
              : busy
                ? "Aplicando la importación"
                : "Importación en pausa"}
          </h2>
          {job.status === "validating" && !busy ? (
            <>
              <p className="text-muted-foreground max-w-prose text-sm">
                Las filas ya se subieron; falta validarlas antes de revisar.
              </p>
              <div>
                <Button
                  onClick={() => {
                    setError(null);
                    void validate(job.id)
                      .catch(fail)
                      .finally(() => setBusy(null));
                  }}
                  type="button"
                >
                  Continuar validación
                </Button>
              </div>
            </>
          ) : !busy ? (
            <>
              <p className="text-muted-foreground max-w-prose text-sm">
                {job.failureMessage ?? "La importación quedó a medias."} Lo ya
                aplicado se conserva y puedes continuar sin duplicar nada.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => void apply(job.id, toApply)}
                  type="button"
                >
                  Continuar importación
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button
                onClick={() => {
                  abort.current?.abort();
                  void pauseApply(job.id).catch(fail);
                }}
                type="button"
                variant="secondary"
              >
                Pausar
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {step === "result" && job ? (
        <section className="flex flex-col gap-4" aria-labelledby="result-title">
          <h2 className="text-lg font-semibold" id="result-title">
            {job.status === "undone"
              ? "Importación deshecha"
              : "Importación aplicada"}
          </h2>
          <p className="text-sm">
            {(job.counts.applied ?? 0).toLocaleString("es-MX")} filas aplicadas
            de {job.fileName}.
            {errors > 0
              ? ` ${errors.toLocaleString("es-MX")} filas con errores no se aplicaron.`
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/app/personas">Ver personas</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/app/personas/importaciones">Ver historial</Link>
            </Button>
            {errors > 0 ? (
              <Button asChild variant="secondary">
                <a download href={`/api/import/personas/${job.id}/errors`}>
                  Descargar errores
                </a>
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
};
