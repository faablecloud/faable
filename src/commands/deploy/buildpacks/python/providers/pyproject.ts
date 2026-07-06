import { PythonProvider } from "./PythonProvider";

export const pyproject_provider: PythonProvider = {
  name: "pyproject",
  files: ["pyproject.toml"],
  resolve() {
    return {
      // `pip install .` builds the package, so it needs the full source —
      // no install_files: the install runs after `COPY . .`.
      install_command: "pip install --no-cache-dir .",
    };
  },
};
