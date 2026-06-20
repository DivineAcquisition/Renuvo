import { captureError, log } from "./logger";

/** Run a critical flow with timing + error capture. Re-throws so callers still
 *  control control-flow; observability is a side effect. */
export async function withMonitoring<T>(
  event: string,
  ctx: { orgId?: string },
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const r = await fn();
    log.info(`${event}_ok`, { ...ctx, event, ms: Date.now() - start });
    return r;
  } catch (e) {
    captureError(e, { ...ctx, event });
    throw e;
  }
}
