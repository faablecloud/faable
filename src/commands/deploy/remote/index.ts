import { FaableApi, FaableApp } from "../../../api/FaableApi";
import { log } from "../../../log";
import { git_context } from "../git_context";
import { follow_remote_build } from "./follow";
import { collect_manifest } from "./manifest";
import { upload_missing_blobs } from "./upload";

export interface DeployRemoteProps {
  api: FaableApi;
  app: FaableApp;
  git: Awaited<ReturnType<typeof git_context>>;
  workdir: string;
}

/**
 * Remote build (arch/deploy/remote-artifact-default-cutover.md): upload the
 * source delta to the CAS, create the deployment with `source` (manifest only —
 * the builder re-detects the framework server-side) and follow the server-side
 * build until the handoff. No Docker daemon, no local buildpacks.
 *
 * There is no local fallback anymore: the CLI no longer builds. Any failure —
 * a rejected admission (`remote_build_disabled` when the app opted out with
 * build_mode=local, or the global kill-switch is off), an upload error, or a
 * BUILD_ERROR — throws so the command exits red.
 */
export const deploy_remote = async (
  props: DeployRemoteProps
): Promise<{ id: string }> => {
  const { api, app, git, workdir } = props;

  log.info(`☁️ Remote build`);

  const manifest = await collect_manifest(workdir);
  log.info(`🗂️ ${manifest.length} files in the source manifest`);
  await upload_missing_blobs(api, app.id, workdir, manifest);

  // No `plan`: the builder re-detects on the assembled tree and syncs the app's
  // runtime_strategy on completion.
  const deployment = await api.createDeployment({
    app_id: app.id,
    source: { manifest },
    ...git,
  });

  log.info(`Preparing to build in faable cloud · ${deployment.id}`);
  await follow_remote_build(api, deployment.id);
  return deployment;
};
