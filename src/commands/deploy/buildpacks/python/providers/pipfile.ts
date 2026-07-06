import { PythonProvider } from "./PythonProvider";

export const pipfile_provider: PythonProvider = {
  name: "pipfile",
  files: ["Pipfile"],
  resolve() {
    return {
      // `pipenv install --deploy` reads Pipfile.lock too — keep the install
      // after `COPY . .` so it sees whatever the repo ships.
      install_command:
        "pip install --no-cache-dir pipenv && pipenv install --system --deploy",
    };
  },
};
