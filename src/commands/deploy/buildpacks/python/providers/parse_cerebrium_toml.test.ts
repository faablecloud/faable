import test from "ava";
import { parse_cerebrium_toml } from "./parse_cerebrium_toml";

test("full manifest: version, pip specs, names", (t) => {
  const m = parse_cerebrium_toml(`
[cerebrium.deployment]
name = "cere"
python_version = "3.11"

[cerebrium.dependencies.pip]
fastapi = "latest"
uvicorn = ""
torch = ">=2.0.0"
numpy = "1.26.4"
`);
  t.is(m.python_version, "3.11");
  t.deepEqual(m.pip_packages, ["fastapi", "uvicorn", "torch>=2.0.0", "numpy==1.26.4"]);
  t.deepEqual(m.pip_names, ["fastapi", "uvicorn", "torch", "numpy"]);
  t.is(m.pip_requirements_file, undefined);
  t.is(m.entrypoint, undefined);
});

test("paths.pip points to a requirements file", (t) => {
  const m = parse_cerebrium_toml(`
[cerebrium.dependencies.paths]
pip = "deps/requirements.txt"
`);
  t.is(m.pip_requirements_file, "deps/requirements.txt");
});

test("entrypoint as array joins into a command; as string passes through", (t) => {
  const arr = parse_cerebrium_toml(`
[cerebrium.runtime.custom]
entrypoint = ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`);
  t.is(arr.entrypoint, "uvicorn main:app --host 0.0.0.0 --port 8000");

  const str = parse_cerebrium_toml(`
[cerebrium.runtime.custom]
entrypoint = "python server.py"
`);
  t.is(str.entrypoint, "python server.py");
});

test("missing sections → empty manifest, no throw", (t) => {
  const m = parse_cerebrium_toml(`[cerebrium.hardware]\ncpu = 2\n`);
  t.deepEqual(m.pip_packages, []);
  t.is(m.python_version, undefined);
  t.is(m.entrypoint, undefined);
});

test("apt/conda tables are ignored without failing", (t) => {
  const m = parse_cerebrium_toml(`
[cerebrium.dependencies.pip]
fastapi = "latest"

[cerebrium.dependencies.apt]
ffmpeg = "latest"

[cerebrium.dependencies.conda]
cudatoolkit = "11.8"
`);
  t.deepEqual(m.pip_names, ["fastapi"]);
});
