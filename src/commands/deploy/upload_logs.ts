import { FaableApi } from "../../api/FaableApi";
import { buildLog } from "../../lib/log_buffer";
import { log } from "../../log";

// Best-effort by design: attaching logs (or recording a failed build) must
// never break or fail a deploy — an older API without these endpoints just
// produces a warn.

export const upload_logs = async (
  api: FaableApi,
  deployment_id: string
): Promise<void> => {
  try {
    const { content, truncated } = buildLog.contents();
    if (!content) return;
    await api.uploadDeploymentLogs(deployment_id, { content, truncated });
    log.info(`📝 Build logs attached to deployment ${deployment_id}`);
  } catch (error: any) {
    log.warn(`Could not upload build logs (non-fatal): ${error.message}`);
  }
};

// Live log sync during the build: re-upload the whole buffer every interval
// while it grows. The API endpoint is an idempotent replace (one log row per
// deployment), so partial uploads are simply superseded — the dashboard sees
// the build progressing instead of only the final dump. Rate-limit friendly:
// 10s interval = 6 req/min against the endpoint's 30/min cap.
export const start_log_sync = (
  api: FaableApi,
  deployment_id: string,
  intervalMs = 10_000
): (() => void) => {
  let lastSize = 0;
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    const { content, truncated, size } = buildLog.contents();
    if (!content || size === lastSize) return;
    inFlight = true;
    try {
      await api.uploadDeploymentLogs(deployment_id, { content, truncated });
      lastSize = size;
    } catch (error: any) {
      // Quiet: the final upload_logs still runs at the end of the deploy.
      log.debug(`Log sync failed (non-fatal): ${error.message}`);
    } finally {
      inFlight = false;
    }
  }, intervalMs);
  // Never keep the process alive just for log syncing.
  timer.unref?.();
  return () => clearInterval(timer);
};

// Mark the create-first deployment as a failed build (phase BUILD_ERROR) and
// attach the captured logs. The deployment row already exists — created
// before the build started — so unlike the old flow no extra row is created
// (and no quota is consumed) to record the failure.
export const mark_build_failure = async (
  api: FaableApi,
  {
    deployment_id,
    app,
  }: { deployment_id: string; app: { id: string; team: string } }
): Promise<void> => {
  try {
    await api
      .updateDeploymentStatus(deployment_id, { phase: "BUILD_ERROR" })
      .catch((error: any) =>
        log.warn(`Could not mark deployment BUILD_ERROR: ${error.message}`)
      );
    await upload_logs(api, deployment_id);
    log.error(
      `❌ Build failed — logs attached to deployment ${deployment_id} · https://dashboard.faable.com/deploy/${app.team}/app/${app.id}`
    );
  } catch (error: any) {
    log.warn(`Could not report the failed build (non-fatal): ${error.message}`);
  }
};
