import fs from "fs-extra";
import path from "path";
import { PackageJson } from "type-fest";
import * as R from "ramda";
import { log } from "../../../log";

/**
 * A static framework produces a directory of static assets (a SPA) that needs
 * to be served by a static server, instead of running its own node process.
 *
 * - `outputDir` is the build output relative to the project root.
 * - `serveCommand` builds the container start command used when the project
 *   does NOT define its own `start` script. It must bind to 0.0.0.0 and the
 *   `$PORT` env var (=80, set in the Dockerfile).
 * - `injectServe` is true for frameworks without a bundled preview/serve tool
 *   (CRA, Vue, Angular): we install the standalone `serve` package into the
 *   workdir before building the image so it ships in node_modules (no runtime
 *   download). Vite/Astro/Gatsby ship their own and don't need it.
 * - `resolveOutput` lets a framework compute its output dir dynamically
 *   (Angular reads it from angular.json).
 */
export interface Framework {
  type: string;
  /** Package names that, if present in (dev)dependencies, identify the framework. */
  deps: string[];
  outputDir?: string;
  serveCommand?: (dir: string) => string;
  injectServe?: boolean;
  resolveOutput?: (workdir: string) => string;
}

const has_dep = (pkg: PackageJson, name: string) =>
  Boolean(
    R.view(R.lensPath(["dependencies", name]), pkg) ||
      R.view(R.lensPath(["devDependencies", name]), pkg)
  );

/**
 * Read Angular's build output path from angular.json. Defaults to `dist` when
 * it can't be resolved. Angular ≥17 (application builder) emits into
 * `<outputPath>/browser`, so we append it when the project uses that builder.
 */
export const resolve_angular_output = (workdir: string): string => {
  const fallback = "dist";
  try {
    const angular_json = fs.readJSONSync(path.join(workdir, "angular.json"));
    const projects = angular_json?.projects ?? {};
    const project_name =
      angular_json?.defaultProject ?? Object.keys(projects)[0];
    const build = projects?.[project_name]?.architect?.build;
    const output = build?.options?.outputPath as string | undefined;
    if (!output) return fallback;

    const builder: string = build?.builder ?? "";
    const is_application_builder =
      builder.includes("application") || builder.includes("browser-esbuild");
    return is_application_builder ? path.join(output, "browser") : output;
  } catch {
    return fallback;
  }
};

/**
 * Framework registry, evaluated in order. Order matters: Astro/SvelteKit/CRA
 * pull Vite in transitively, so Vite must be the last static fallback.
 */
export const FRAMEWORKS: Framework[] = [
  // Next.js: handled by its own runtime_strategy/PVC, never static-served here.
  { type: "next", deps: ["next"] },

  {
    type: "astro",
    deps: ["astro"],
    outputDir: "dist",
    serveCommand: (dir) => `npx astro preview --host 0.0.0.0 --port $PORT`,
  },
  {
    type: "gatsby",
    deps: ["gatsby"],
    outputDir: "public",
    serveCommand: (dir) => `npx gatsby serve --host 0.0.0.0 --port $PORT`,
  },
  {
    type: "cra",
    deps: ["react-scripts"],
    outputDir: "build",
    injectServe: true,
    serveCommand: (dir) => `npx serve -s ${dir} -l $PORT`,
  },
  {
    type: "vue",
    deps: ["@vue/cli-service"],
    outputDir: "dist",
    injectServe: true,
    serveCommand: (dir) => `npx serve -s ${dir} -l $PORT`,
  },
  {
    type: "angular",
    deps: ["@angular/cli", "@angular-devkit/build-angular"],
    injectServe: true,
    resolveOutput: resolve_angular_output,
    serveCommand: (dir) => `npx serve -s ${dir} -l $PORT`,
  },
  {
    type: "vite",
    deps: ["vite"],
    outputDir: "dist",
    serveCommand: (dir) => `npx vite preview --host 0.0.0.0 --port $PORT`,
  },
];

export interface DetectedFramework {
  type: string;
  /** Container start command to serve the static output, or null if none. */
  start_command: string | null;
  /** Whether the standalone `serve` package must be injected before build. */
  inject_serve: boolean;
}

interface DetectParams {
  pkg: PackageJson;
  workdir: string;
  /** True when package.json defines a `start` script (e.g. custom SSR server). */
  has_start: boolean;
}

/**
 * Detect the framework from package.json and compute how to serve it.
 *
 * When the project defines its own `start` script we never override it (the app
 * ships a real server — custom SSR, Nuxt, Remix, SvelteKit node-adapter, etc.),
 * so `start_command`/`inject_serve` stay neutral.
 */
export const detect_framework = (params: DetectParams): DetectedFramework => {
  const { pkg, workdir, has_start } = params;

  const framework = FRAMEWORKS.find((fw) =>
    fw.deps.some((dep) => has_dep(pkg, dep))
  );

  if (!framework) {
    return { type: "node", start_command: null, inject_serve: false };
  }

  // Static frameworks only override the start command when the project doesn't
  // ship its own server.
  if (framework.serveCommand && !has_start) {
    const output_dir = framework.resolveOutput
      ? framework.resolveOutput(workdir)
      : framework.outputDir ?? "dist";
    const start_command = framework.serveCommand(output_dir);
    log.info(
      `No start script on package.json, serving ${framework.type} output (${output_dir}) with [${start_command}]`
    );
    return {
      type: framework.type,
      start_command,
      inject_serve: Boolean(framework.injectServe),
    };
  }

  return { type: framework.type, start_command: null, inject_serve: false };
};
