import { BuildPlan } from "@faabletools/buildpacks";
import { FaableApi, FaableApp } from "../../../api/FaableApi";
import { log } from "../../../log";
import { git_context } from "../git_context";
import { follow_remote_build } from "./follow";
import { collect_manifest } from "./manifest";
import { upload_missing_blobs } from "./upload";

export interface DeployRemoteProps {
  api: FaableApi;
  app: FaableApp;
  plan: BuildPlan;
  git: Awaited<ReturnType<typeof git_context>>;
  workdir: string;
  /** --remote was passed: fail hard instead of falling back to local. */
  explicit: boolean;
}

/**
 * Remote build path (v2, arch/deploy/deploy-v2-remote-build.md): upload the
 * source delta to the CAS, create the deployment with `source` (manifest +
 * serialized BuildPlan) and follow the server-side build until the image
 * handoff. No Docker daemon needed.
 *
 * Fallback contract:
 *  - PRE-build failures (collection, upload, create — including the server
 *    gate `remote_build_disabled`) return null when the mode came from the
 *    server, so the caller falls back to a local build. With --remote they
 *    fail hard (testing wants to see the errors).
 *  - Failures AFTER the deployment exists never fall back: a BUILD_ERROR
 *    would fail locally too (it's the user's build), and a timeout may still
 *    be building — a local fallback would double-deploy.
 */
export const deploy_remote = async (
  props: DeployRemoteProps
): Promise<{ id: string } | null> => {
  const { api, app, plan, git, workdir, explicit } = props;

  log.info(
    `☁️ Remote build (${explicit ? "--remote" : `app build_mode=remote`})`
  );

  let deployment: { id: string };
  try {
    const manifest = await collect_manifest(workdir);
    log.info(`🗂️ ${manifest.length} files in the source manifest`);
    await upload_missing_blobs(api, app.id, workdir, manifest);

    deployment = await api.createDeployment({
      app_id: app.id,
      type: plan.type,
      source: { manifest, plan },
      ...git,
    });
  } catch (error: any) {
    if (explicit) throw error;
    const code = error?.response?.data?.code;
    log.warn(
      `☁️ Remote build unavailable${code ? ` (${code})` : `: ${error.message}`}`
    );
    return null;
  }

  log.info(`Preparing to build in faable cloud · ${deployment.id}`);
  await follow_remote_build(api, deployment.id);
  return deployment;
};
