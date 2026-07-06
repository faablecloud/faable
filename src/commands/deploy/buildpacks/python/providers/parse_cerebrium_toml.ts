import { parse } from "smol-toml";
import { log } from "../../../../../log";

/**
 * The subset of cerebrium.toml Faable understands. Reference shape:
 *
 *   [cerebrium.deployment]
 *   name = "my-app"
 *   python_version = "3.11"
 *
 *   [cerebrium.dependencies.pip]
 *   fastapi = "latest"
 *   torch = ">=2.0.0"
 *
 *   [cerebrium.dependencies.paths]
 *   pip = "requirements.txt"
 *
 *   [cerebrium.runtime.custom]
 *   entrypoint = ["uvicorn", "main:app", "--host", "0.0.0.0"]
 */
export interface CerebriumManifest {
  python_version?: string;
  /** Pip requirement specs, ready for `pip install` (e.g. `fastapi`, `torch>=2.0.0`). */
  pip_packages: string[];
  /** Bare package names, for the framework-detection dependency blob. */
  pip_names: string[];
  /** Requirements file referenced by [cerebrium.dependencies.paths] pip. */
  pip_requirements_file?: string;
  /** Start command from [cerebrium.runtime.custom] entrypoint. */
  entrypoint?: string;
}

type TomlTable = Record<string, unknown>;

const table = (value: unknown): TomlTable =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as TomlTable)
    : {};

/**
 * Turn the pip table into installable requirement specs. Cerebrium uses
 * `"latest"` / `""` for unpinned packages; anything else is a version spec —
 * exact pins (`"2.0.0"`) become `==`, ranges (`">=2.0"`) pass through.
 */
const to_spec = (name: string, version: unknown): string => {
  const v = String(version ?? "").trim();
  if (!v || v.toLowerCase() === "latest") return name;
  if (/^[0-9]/.test(v)) return `${name}==${v}`;
  return `${name}${v}`;
};

export const parse_cerebrium_toml = (content: string): CerebriumManifest => {
  const root = table(table(parse(content)).cerebrium);
  const deployment = table(root.deployment);
  const dependencies = table(root.dependencies);
  const pip = table(dependencies.pip);
  const paths = table(dependencies.paths);
  const custom = table(table(root.runtime).custom);

  for (const skipped of ["apt", "conda"] as const) {
    if (Object.keys(table(dependencies[skipped])).length > 0) {
      log.warn(
        `cerebrium.toml declares ${skipped} dependencies — Faable only installs the pip table, ${skipped} packages are ignored`
      );
    }
  }

  const pip_names = Object.keys(pip);
  const pip_packages = pip_names.map((name) => to_spec(name, pip[name]));

  const entrypoint_raw = custom.entrypoint;
  const entrypoint = Array.isArray(entrypoint_raw)
    ? entrypoint_raw.map(String).join(" ")
    : typeof entrypoint_raw === "string" && entrypoint_raw.trim()
      ? entrypoint_raw.trim()
      : undefined;

  const python_version =
    typeof deployment.python_version === "string" &&
    deployment.python_version.trim()
      ? deployment.python_version.trim()
      : undefined;

  const pip_requirements_file =
    typeof paths.pip === "string" && paths.pip.trim()
      ? paths.pip.trim()
      : undefined;

  return {
    python_version,
    pip_packages,
    pip_names,
    pip_requirements_file,
    entrypoint,
  };
};
