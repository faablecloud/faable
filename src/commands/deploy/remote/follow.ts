import { FaableApi } from "../../../api/FaableApi";
import { log } from "../../../log";

const POLL_INTERVAL_MS = 4000;
// Queue wait + build must fit here; the server's own stops (Job deadline
// 30min, abandoned janitor 60min) resolve the deployment first in practice.
const FOLLOW_TIMEOUT_MS = 45 * 60 * 1000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Follow a remote build until the image handoff: poll the phase and tail the
 * build logs the builder uploads every ~10s (replace semantics → print the
 * suffix beyond what we already showed). Returns on INITIALIZING/READY
 * (image landed — the regular promotion poll takes over); throws on
 * BUILD_ERROR/ERROR with the server-provided reason.
 */
export const follow_remote_build = async (
  api: FaableApi,
  deployment_id: string
): Promise<void> => {
  let printed = 0;
  let last_phase = "";
  const started = Date.now();

  const tail_logs = async () => {
    try {
      const logs = await api.getDeploymentLogs(deployment_id);
      const content = logs?.content ?? "";
      if (content.length > printed) {
        process.stdout.write(content.slice(printed));
        printed = content.length;
      } else if (content.length < printed) {
        // Keep-tail truncation rotated the buffer — resync silently.
        printed = content.length;
      }
    } catch {
      // No logs yet (404) or transient failure — next poll.
    }
  };

  while (Date.now() - started < FOLLOW_TIMEOUT_MS) {
    const deployment = await api
      .getDeployment(deployment_id)
      .catch(() => null);
    const phase = deployment?.status?.phase ?? "";

    if (phase !== last_phase && phase) {
      log.info(`☁️ Remote build: ${phase}`);
      last_phase = phase;
    }

    await tail_logs();

    if (phase === "BUILD_ERROR" || phase === "ERROR") {
      const reason = deployment?.status?.reason;
      throw new Error(
        `Remote build failed${reason ? `: ${reason}` : ""}`.trim()
      );
    }
    // Image handoff done: the controller claimed it (INITIALIZING) or it is
    // already live (READY) — the promotion poll takes over from here.
    if (phase === "INITIALIZING" || phase === "READY") {
      await tail_logs();
      return;
    }

    await wait(POLL_INTERVAL_MS);
  }

  throw new Error(
    "Timed out waiting for the remote build. Check the dashboard for its status."
  );
};
