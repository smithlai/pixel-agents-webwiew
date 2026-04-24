/**
 * Heartbeat file path helpers — mirrors MobileGoose's `goose-log-wrapper.py`
 * so both sides produce/consume the exact same filenames.
 *
 * MobileGoose writes `<sanitize(testrun)>.heartbeat` into its runtime/sessions
 * directory every 30 seconds via a daemon thread.  pixel-agents writes a
 * placeholder of the same file the moment a task is dispatched — this removes
 * the 3~5 second gap between dispatch and the wrapper process starting.
 *
 * Source of truth: MobileGoose/tools/goose-log-wrapper.py:59 (sanitize_testrun).
 */

/**
 * Sanitize a testrun name for safe filesystem use.
 *
 * ⚠️  KEEP IN SYNC with MobileGoose/tools/goose-log-wrapper.py `sanitize_testrun()`.
 *     Both sides must produce identical output for the same input — any divergence
 *     silently breaks heartbeat file matching.  If you change this regex, update
 *     the Python counterpart in the same commit (and vice versa).
 *
 * Rules (must match Python exactly):
 *   1. replace any non-[A-Za-z0-9_.-] char with "_"
 *   2. collapse consecutive underscores
 *   3. strip leading/trailing underscores
 */
export function sanitizeTestrun(name: string): string {
  let safe = name.replace(/[^a-zA-Z0-9_.\-]/g, '_');
  safe = safe.replace(/_+/g, '_');
  return safe.replace(/^_+|_+$/g, '');
}

/** Build the heartbeat filename for a given sessionId. */
export function heartbeatFilename(sessionId: string): string {
  return `${sanitizeTestrun(sessionId)}.heartbeat`;
}
