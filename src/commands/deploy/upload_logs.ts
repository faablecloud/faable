import { FaableApi } from "../../api/FaableApi";
import { buildLog } from "../../lib/log_buffer";
import { log } from "../../log";
import { git_context } from "./git_context";

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

// Record a failed build as a BUILD_ERROR deployment (no image — the
// controller skips materialization) with the captured logs attached, so
// private-repo CI failures are debuggable from the platform.
export const report_build_failure = async (
  api: FaableApi,
  { app, workdir }: { app: { id: string; team: string }; workdir: string }
): Promise<void> => {
  try {
    const git = await git_context({ workdir }).catch(() => ({}));
    // No `image` and no `type`: a failed build must not materialize anything
    // nor rewrite the app's runtime_strategy.
    const failed = await api.createDeployment({ app_id: app.id, ...git });
    await api
      .updateDeploymentStatus(failed.id, { phase: "BUILD_ERROR" })
      .catch((error: any) =>
        log.warn(`Could not mark deployment BUILD_ERROR: ${error.message}`)
      );
    await upload_logs(api, failed.id);
    log.error(
      `❌ Build failed — logs attached to deployment ${failed.id} · https://dashboard.faable.com/deploy/${app.team}/app/${app.id}`
    );
  } catch (error: any) {
    log.warn(`Could not report the failed build (non-fatal): ${error.message}`);
  }
};
