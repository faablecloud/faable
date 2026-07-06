import test from "ava";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { python_buildpack } from "../index";
import { cerebrium_provider } from "./cerebrium";

const __dirname = dirname(fileURLToPath(import.meta.url));

const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "faable-cere-"));
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};

test("plan over the cerebrium-fastapi fixture (masyosh/cere shape)", async (t) => {
  const fixture = join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "examples",
    "cerebrium-fastapi"
  );
  const plan = await python_buildpack.detect({ workdir: fixture, config: {} });
  t.truthy(plan);
  t.is(plan!.buildpack, "python");
  t.is(plan!.type, "python");
  t.is(plan!.runtime.version, "3.11");
  t.is(plan!.from, "python:3.11");
  // fastapi in the toml feeds framework detection → uvicorn over main.py
  t.is(plan!.start_command, "uvicorn main:app --host 0.0.0.0 --port $PORT");
  // uvicorn already declared in the toml → no server injection
  t.is(plan!.install_command, 'pip install --no-cache-dir "fastapi" "uvicorn"');
  t.deepEqual(plan!.install_files, ["cerebrium.toml"]);
});

test("classic manifest wins over cerebrium.toml (provider order)", async (t) => {
  const dir = project({
    "requirements.txt": "flask\ngunicorn\n",
    "cerebrium.toml": `[cerebrium.dependencies.pip]\nfastapi = "latest"\n`,
    "app.py": "app = Flask(__name__)\n",
  });
  const plan = await python_buildpack.detect({ workdir: dir, config: {} });
  t.is(plan!.install_command, "pip install --no-cache-dir -r requirements.txt");
  t.deepEqual(plan!.install_files, ["requirements.txt"]);
});

test("paths.pip → install from the referenced file, both files in the cache layer", (t) => {
  const dir = project({
    "cerebrium.toml": `[cerebrium.dependencies.paths]\npip = "reqs.txt"\n`,
    "reqs.txt": "fastapi\n",
  });
  const resolved = cerebrium_provider.resolve(dir);
  t.is(resolved.install_command, "pip install --no-cache-dir -r reqs.txt");
  t.deepEqual(resolved.install_files, ["reqs.txt", "cerebrium.toml"]);
});

test("toml entrypoint is used as start hint", async (t) => {
  const dir = project({
    "cerebrium.toml": `[cerebrium.dependencies.pip]
fastapi = "latest"

[cerebrium.runtime.custom]
entrypoint = ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$PORT"]
`,
    "main.py": "app = FastAPI()\n",
  });
  const plan = await python_buildpack.detect({ workdir: dir, config: {} });
  t.is(plan!.start_command, "uvicorn main:app --host 0.0.0.0 --port $PORT");
});

test("no web entrypoint resolvable → error mentions Cerebrium and startCommand", async (t) => {
  const dir = project({
    "cerebrium.toml": `[cerebrium.dependencies.pip]\ntorch = ">=2.0.0"\n`,
    "main.py": "def run(): pass\n",
  });
  const err = await t.throwsAsync(() =>
    python_buildpack.detect({ workdir: dir, config: {} })
  );
  t.regex(err!.message, /Cerebrium/);
  t.regex(err!.message, /startCommand/);
});
