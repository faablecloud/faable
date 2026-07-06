import test from "ava";
import { render_dockerfile } from "./docker_image";

// Snapshots lock the unified template byte-for-byte. Intentional diffs vs the
// legacy per-pipeline templates: START_COMMAND is now escaped for node too
// ($PORT survives the unquoted build heredoc), and python installs with a
// cacheable manifest layer (COPY manifests → RUN install → COPY . .).

const NODE_BANNER = `NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
YARN_VERSION=$(yarn --version)

echo "Faable Cloud · [node $NODE_VERSION] [npm $NPM_VERSION] [yarn $YARN_VERSION]"`;

const PY_BANNER = `PYTHON_VERSION=$(python --version 2>&1)
PIP_VERSION=$(pip --version 2>&1)

echo "Faable Cloud · [$PYTHON_VERSION] [$PIP_VERSION]"`;

test("node dockerfile: default npm start", (t) => {
  t.snapshot(
    render_dockerfile({
      from: "node:22.1.0",
      env: { NODE_ENV: "production" },
      banner: NODE_BANNER,
      start_command: "npm run start",
    })
  );
});

test("node dockerfile: static framework serve command keeps $PORT escaped", (t) => {
  const rendered = render_dockerfile({
    from: "node:20.11.1",
    env: { NODE_ENV: "production" },
    banner: NODE_BANNER,
    start_command: "npx serve -s build -l $PORT",
  });
  t.true(rendered.includes('ENV START_COMMAND="npx serve -s build -l \\$PORT"'));
  t.snapshot(rendered);
});

test("python dockerfile: cacheable requirements layer before COPY . .", (t) => {
  const rendered = render_dockerfile({
    from: "python:3.11.3",
    env: { PYTHONUNBUFFERED: "1" },
    banner: PY_BANNER,
    start_command: "uvicorn main:app --host 0.0.0.0 --port $PORT",
    install_command:
      "pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir uvicorn[standard]",
    install_files: ["requirements.txt"],
  });
  const copy_manifest = rendered.indexOf("COPY requirements.txt ./");
  const run_install = rendered.indexOf("RUN pip install");
  const copy_all = rendered.indexOf("COPY . .");
  t.true(copy_manifest > -1 && copy_manifest < run_install);
  t.true(run_install < copy_all);
  t.snapshot(rendered);
});

test("python dockerfile: source-dependent install runs after COPY . .", (t) => {
  const rendered = render_dockerfile({
    from: "python:3.12",
    env: { PYTHONUNBUFFERED: "1" },
    banner: PY_BANNER,
    start_command: "gunicorn app:app --bind 0.0.0.0:$PORT",
    install_command: "pip install --no-cache-dir .",
  });
  t.true(rendered.indexOf("COPY . .") < rendered.indexOf("RUN pip install"));
  t.snapshot(rendered);
});

test("no install command renders no RUN install at all", (t) => {
  const rendered = render_dockerfile({
    from: "node:22.1.0",
    env: { NODE_ENV: "production" },
    banner: NODE_BANNER,
    start_command: "npm run start",
  });
  t.false(rendered.includes("RUN pip"));
  t.is(rendered.match(/RUN /g)!.length, 1); // only the entrypoint echo
});

test("escape survives quotes, backticks, dollars and newlines", (t) => {
  const rendered = render_dockerfile({
    from: "python:3.12",
    env: {},
    banner: PY_BANNER,
    start_command: `sh -c 'echo "hi \`whoami\`" && python -m app --port $PORT'`,
    install_command: "true",
  });
  t.snapshot(rendered);
});
