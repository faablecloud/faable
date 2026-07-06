import fs from "fs-extra";
import path from "path";

const DEFAULT_VERSION = "3.11.3";

/**
 * Resolve the Python version from (in order):
 *  1. runtime.txt          → `python-3.11.3`
 *  2. .python-version      → `3.11.3` (pyenv)
 *  3. provider hint        → e.g. cerebrium.toml `python_version`
 *  4. pyproject.toml       → `requires-python = ">=3.11"` (first concrete X.Y[.Z])
 * Falls back to DEFAULT_VERSION.
 */
export const resolve_python_version = (
  workdir: string,
  provider_hint?: string
): string => {
  const runtime_config = path.join(workdir, "runtime.txt");
  if (fs.existsSync(runtime_config)) {
    const runtime_data = fs.readFileSync(runtime_config).toString().trim();
    if (!runtime_data.startsWith("python-")) {
      throw new Error(
        "runtime.txt must have runtime format with python-<version>"
      );
    }
    return runtime_data.split("-")[1];
  }

  const python_version_file = path.join(workdir, ".python-version");
  if (fs.existsSync(python_version_file)) {
    const version = fs.readFileSync(python_version_file).toString().trim();
    if (version) return version;
  }

  if (provider_hint) return provider_hint;

  const pyproject = path.join(workdir, "pyproject.toml");
  if (fs.existsSync(pyproject)) {
    const toml = fs.readFileSync(pyproject).toString();
    const match = toml.match(
      /requires-python\s*=\s*["'][^0-9]*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/
    );
    if (match?.[1]) return match[1];
  }

  return DEFAULT_VERSION;
};
