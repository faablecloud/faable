import { FaableApp, Secret } from "../../../api/FaableApi";

/**
 * Subset of faable.json a buildpack may consult. Always injected via the
 * context — buildpacks never touch the Configuration singleton directly.
 */
export interface DeployConfig {
  startCommand?: string;
  buildCommand?: string;
  buildpack?: string;
}

export interface DetectContext {
  workdir: string;
  config: DeployConfig;
}

export interface BuildContext extends DetectContext {
  app: FaableApp;
  env_vars: Secret[];
}

/**
 * Everything decided at detect time; build() executes it without re-analyzing.
 * Deterministic for a given workdir+config (modulo external version
 * resolution), which keeps it serializable for a future server-side build.
 */
export interface BuildPlan {
  /** Registry name of the buildpack that produced the plan. */
  buildpack: string;
  /** For logging: "node 22.1.0", "python 3.11.3". */
  runtime: { name: string; version?: string };
  /**
   * Deployment `type` sent to createDeployment. API contract: the backend
   * only branches on "next" (build-cache PVC); every other value is inert
   * server-side. Values today: next|astro|gatsby|cra|vue|angular|vite|node|python.
   */
  type: string;
  /**
   * Resolved container start command (all precedence applied), or null for
   * the docker buildpack (the image's own CMD rules).
   */
  start_command: string | null;
  /** Command run inside the image build (python installs). */
  install_command?: string;
  /**
   * Manifests to COPY before the install RUN so the dependency layer stays
   * cached until they change (CNB-style layers). Absent → install runs after
   * `COPY . .` (needed when the install reads the full source, e.g.
   * `pip install .`).
   */
  install_files?: string[];
  /** Node-only: npm script name to run on the host before packaging. */
  build_script?: string | null;
  /** Node-only: install the standalone `serve` package before packaging. */
  inject_serve?: boolean;
  /** Base image for the shared renderer (e.g. "node:22.1.0"); absent for docker. */
  from?: string;
}

/**
 * A buildpack claims a project (detect) and executes its plan (build).
 *
 * detect() contract: return null ONLY when the trigger files are absent
 * ("not mine"). Once a trigger file exists the buildpack has claimed the
 * project and must return a plan or THROW with an actionable message — never
 * fall through silently to the next buildpack.
 *
 * detect_fallback() is the optional second pass for weak signals (a bare
 * main.py) that must lose against any other buildpack's strong trigger
 * (a Dockerfile). The registry only runs it when no buildpack claimed the
 * project in the strong pass.
 */
export interface Buildpack {
  name: string;
  /** Strong trigger files — shown in detection-failure diagnostics. */
  detect_files: string[];
  /** Weak trigger files for the fallback pass. */
  fallback_files?: string[];
  detect(ctx: DetectContext): Promise<BuildPlan | null>;
  detect_fallback?(ctx: DetectContext): Promise<BuildPlan | null>;
  /** Execute the plan; must leave a local linux/amd64 image tagged `${app.id}`. */
  build(ctx: BuildContext, plan: BuildPlan): Promise<void>;
}

/** One-line summary logged before build so the decision is reconstructible. */
export const plan_summary = (plan: BuildPlan): string =>
  JSON.stringify({
    buildpack: plan.buildpack,
    type: plan.type,
    runtime: `${plan.runtime.name}${plan.runtime.version ? `-${plan.runtime.version}` : ""}`,
    start: plan.start_command,
    ...(plan.install_command ? { install: plan.install_command } : {}),
    ...(plan.build_script ? { build_script: plan.build_script } : {}),
  });
