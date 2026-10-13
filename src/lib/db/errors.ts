/** Postgres unique violation (23505), also when wrapped as the cause of another error. */
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ((error as { code?: string }).code === "23505" ||
    isUniqueViolation((error as { cause?: unknown }).cause));

/** A live record with the same name (or identifier) already exists in the company. */
export class DuplicateNameError extends Error {
  constructor(message = "Ya existe un registro activo con ese nombre.") {
    super(message);
    this.name = "DuplicateNameError";
  }
}

/** `.catch()` handler: a unique violation becomes DuplicateNameError, anything else rethrows. */
export const rethrowDuplicate =
  (message?: string) =>
  (error: unknown): never => {
    if (isUniqueViolation(error)) {
      throw new DuplicateNameError(message);
    }

    throw error;
  };
