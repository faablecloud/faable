import fs from "fs-extra";
import path from "path";
import { PythonProvider, PythonProviderResult } from "./PythonProvider";
import { parse_cerebrium_toml } from "./parse_cerebrium_toml";

/**
 * Cerebrium projects (cerebrium.toml + a Python entrypoint) declare their pip
 * dependencies and python version in the toml instead of a requirements.txt.
 * This provider translates that manifest so the standard python buildpack can
 * build them — the masyosh/cere onboarding case.
 */
export const cerebrium_provider: PythonProvider = {
  name: "cerebrium",
  files: ["cerebrium.toml"],
  resolve(workdir: string): PythonProviderResult {
    const manifest = parse_cerebrium_toml(
      fs.readFileSync(path.join(workdir, "cerebrium.toml")).toString()
    );

    let install_command: string | undefined;
    let install_files: string[] | undefined;
    if (manifest.pip_requirements_file) {
      install_command = `pip install --no-cache-dir -r ${manifest.pip_requirements_file}`;
      // Copying the referenced file AND the toml ties the cached layer to both.
      install_files = [manifest.pip_requirements_file, "cerebrium.toml"];
    } else if (manifest.pip_packages.length > 0) {
      install_command = `pip install --no-cache-dir ${manifest.pip_packages
        .map((spec) => `"${spec}"`)
        .join(" ")}`;
      // The command inlines the packages; copying the toml keeps the layer
      // cache keyed to the manifest content.
      install_files = ["cerebrium.toml"];
    }

    return {
      install_command,
      install_files,
      python_version: manifest.python_version,
      // Feed the pip package names into the framework-detection blob so e.g.
      // `fastapi` in the toml triggers the existing uvicorn start resolution.
      deps_text: manifest.pip_names.join("\n"),
      start_hint: manifest.entrypoint,
    };
  },
};
