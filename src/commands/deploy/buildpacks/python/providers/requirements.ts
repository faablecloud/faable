import { PythonProvider } from "./PythonProvider";

export const requirements_provider: PythonProvider = {
  name: "requirements",
  files: ["requirements.txt"],
  resolve() {
    return {
      install_command: "pip install --no-cache-dir -r requirements.txt",
      // Copying only the manifest keeps the install layer cached until
      // requirements.txt itself changes.
      install_files: ["requirements.txt"],
    };
  },
};
