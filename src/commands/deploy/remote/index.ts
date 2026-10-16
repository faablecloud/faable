import { Writable } from "stream";
import { FaableApi, FaableApp } from "../../../api/FaableApi";
import { log } from "../../../log";
import { git_context } from "../git_context";
import { format_bytes } from "../inspect/detail";
import { follow_remote_build } from "./follow";
import { collect_manifest, ManifestFile } from "./manifest";
import { upload_missing_blobs } from "./upload";

export interface DeployRemoteProps {
  api: FaableApi;
  app: FaableApp;
  git: Awaited<ReturnType<typeof git_context>>;
  /** Proposed release version (see release_version.ts); omitted when unknown. */
  release?: string;
  workdir: string;
  /** Already collected (`deploy --create` checks the source before creating the app). */
  manifest?: ManifestFile[];
  /** Where the build log is streamed (see follow_remote_build). */
  log_stream?: Writable;
  /** Called once the deployment exists: from here on the app has something to show. */
  on_deployment?: (deployment_id: string) => void;
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
  const { api, app, git, release, workdir } = props;

  log.info(`☁️ Remote build`);

  const manifest = props.manifest ?? (await collect_manifest(workdir));
  // The total is what the api weighs against the plan when the app's last
  // build came out too large — say it before anything is uploaded.
  const total = manifest.reduce((sum, f) => sum + f.size, 0);
  log.info(
    `🗂️ ${manifest.length} files in the source manifest (${format_bytes(total)})`
  );
  await upload_missing_blobs(api, app.id, workdir, manifest);

  // No `plan`: the builder re-detects on the assembled tree and syncs the app's
  // runtime_strategy on completion.
  const deployment = await api.createDeployment({
    app_id: app.id,
    source: { manifest },
    ...(release ? { release } : {}),
    ...git,
  });

  props.on_deployment?.(deployment.id);

  log.info(`Preparing to build in faable cloud · ${deployment.id}`);
  await follow_remote_build(api, deployment.id, props.log_stream);
  return deployment;
};
