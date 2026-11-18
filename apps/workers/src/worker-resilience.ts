// PostgreSQL text cannot contain U+0000. Keep all other report text intact.
export function postgresText(value: string): string {
  return value.replace(/\u0000/g, '');
}

// Drizzle's outer message includes SQL parameters (possibly entire reports or
// credentials). Prefer the underlying error and bound persisted/logged messages.
export function workerErrorMessage(error: unknown): string {
  const seen = new Set<Error>();
  while (error instanceof Error && error.cause instanceof Error && !seen.has(error.cause)) {
    seen.add(error);
    error = error.cause;
  }
  return postgresText(error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

// Failure handling and lease cleanup can themselves fail during a DB outage.
// Always consume those failures before returning to the shared worker loop.
export async function runIsolatedTask(options: {
  run: () => Promise<void>;
  onError: (error: unknown) => Promise<void>;
  cleanup: () => Promise<void>;
  log: (stage: string, error: unknown) => void;
}): Promise<void> {
  try {
    await options.run();
  } catch (error) {
    try {
      await options.onError(error);
    } catch (handlingError) {
      options.log('failure handling', handlingError);
    }
  } finally {
    try {
      await options.cleanup();
    } catch (error) {
      options.log('lease cleanup', error);
    }
  }
}
