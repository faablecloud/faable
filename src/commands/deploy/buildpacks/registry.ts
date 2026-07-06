import { BuildPlan, Buildpack, DetectContext } from "./Buildpack";
import { docker_buildpack } from "./docker";
import { node_buildpack } from "./node";
import { python_buildpack } from "./python";

/**
 * Ordered registry, first claim wins. Order is load-bearing:
 *  1. node before python — full-stack repos shipping both a package.json and
 *     Python manifests build as node (historical rule).
 *  2. python (all its manifest providers) before docker — a dependency
 *     manifest beats a Dockerfile; the Dockerfile is the explicit escape
 *     hatch evaluated last among strong triggers.
 * Weak signals (python's entrypoint fallback) run in a second pass so they
 * lose against ANY strong trigger without buildpacks knowing about each other.
 */
export const BUILDPACKS: Buildpack[] = [
  node_buildpack,
  python_buildpack,
  docker_buildpack,
];

export const buildpack_names = (): string[] => BUILDPACKS.map((b) => b.name);

export const get_buildpack = (name: string): Buildpack | undefined =>
  BUILDPACKS.find((b) => b.name === name);

/**
 * Resolve the buildpack plan for a workdir. `override` (from --buildpack or
 * faable.json) skips detection order and forces one buildpack; it still runs
 * that buildpack's detect so the plan is computed from real project files.
 */
export const detect_buildpack = async (
  ctx: DetectContext,
  override?: string
): Promise<BuildPlan> => {
  if (override) {
    const buildpack = get_buildpack(override);
    if (!buildpack) {
      throw new Error(
        `Unknown buildpack "${override}". Valid buildpacks: ${buildpack_names().join(", ")}.`
      );
    }
    const plan =
      (await buildpack.detect(ctx)) ??
      (await buildpack.detect_fallback?.(ctx)) ??
      null;
    if (!plan) {
      throw new Error(
        `Buildpack "${override}" was forced but none of its trigger files ` +
          `(${[...buildpack.detect_files, ...(buildpack.fallback_files ?? [])].join(", ")}) ` +
          `exist in ${ctx.workdir}.`
      );
    }
    return plan;
  }

  // Strong pass: manifests and Dockerfiles.
  for (const buildpack of BUILDPACKS) {
    const plan = await buildpack.detect(ctx);
    if (plan) return plan;
  }

  // Fallback pass: weak signals, only when nothing claimed the project.
  for (const buildpack of BUILDPACKS) {
    if (!buildpack.detect_fallback) continue;
    const plan = await buildpack.detect_fallback(ctx);
    if (plan) return plan;
  }

  throw new Error("Cannot detect project type");
};
