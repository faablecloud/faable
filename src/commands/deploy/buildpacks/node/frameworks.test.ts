import test from "ava";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PackageJson } from "type-fest";
import { detect_framework, resolve_angular_output } from "./frameworks";

const pkg = (deps: Record<string, string>, dev = false): PackageJson =>
  dev ? { devDependencies: deps } : { dependencies: deps };

const detect = (p: PackageJson, has_start = false, workdir = "/tmp") =>
  detect_framework({ pkg: p, workdir, has_start });

test("next is detected and never static-served", (t) => {
  const r = detect(pkg({ next: "latest" }));
  t.deepEqual(r, { type: "next", start_command: null, inject_serve: false });
});

test("astro serves its dist output without inject_serve", (t) => {
  const r = detect(pkg({ astro: "^4" }));
  t.is(r.type, "astro");
  t.is(r.start_command, "npx astro preview --host 0.0.0.0 --port $PORT");
  t.false(r.inject_serve);
});

test("gatsby serves via gatsby serve", (t) => {
  const r = detect(pkg({ gatsby: "^5" }));
  t.is(r.type, "gatsby");
  t.is(r.start_command, "npx gatsby serve --host 0.0.0.0 --port $PORT");
});

test("cra serves build/ with injected serve", (t) => {
  const r = detect(pkg({ "react-scripts": "5" }));
  t.is(r.type, "cra");
  t.is(r.start_command, "npx serve -s build -l $PORT");
  t.true(r.inject_serve);
});

test("vue-cli serves dist/ with injected serve", (t) => {
  const r = detect(pkg({ "@vue/cli-service": "5" }));
  t.is(r.type, "vue");
  t.is(r.start_command, "npx serve -s dist -l $PORT");
  t.true(r.inject_serve);
});

test("vite serves dist via vite preview", (t) => {
  const r = detect(pkg({ vite: "^5" }));
  t.is(r.type, "vite");
  t.is(r.start_command, "npx vite preview --host 0.0.0.0 --port $PORT");
  t.false(r.inject_serve);
});

test("ordering: astro beats vite when both present (vite is last)", (t) => {
  const r = detect(pkg({ astro: "^4", vite: "^5" }));
  t.is(r.type, "astro");
});

test("devDependencies count for detection", (t) => {
  const r = detect(pkg({ vite: "^5" }, true));
  t.is(r.type, "vite");
});

test("a start script suppresses serve command and inject_serve", (t) => {
  const r = detect(pkg({ vite: "^5" }), true);
  t.is(r.type, "vite");
  t.is(r.start_command, null);
  t.false(r.inject_serve);
});

test("no framework → plain node", (t) => {
  const r = detect(pkg({ express: "^4" }));
  t.deepEqual(r, { type: "node", start_command: null, inject_serve: false });
});

test("angular resolves its output dir from angular.json", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "faable-ng-"));
  writeFileSync(
    join(dir, "angular.json"),
    JSON.stringify({
      projects: {
        web: {
          architect: {
            build: {
              builder: "@angular-devkit/build-angular:application",
              options: { outputPath: "dist/web" },
            },
          },
        },
      },
    })
  );
  t.is(resolve_angular_output(dir), join("dist/web", "browser"));

  const r = detect(pkg({ "@angular/cli": "17" }), false, dir);
  t.is(r.type, "angular");
  t.is(r.start_command, `npx serve -s ${join("dist/web", "browser")} -l $PORT`);
  t.true(r.inject_serve);
});

test("angular legacy builder keeps raw outputPath; missing angular.json → dist", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "faable-ng-"));
  writeFileSync(
    join(dir, "angular.json"),
    JSON.stringify({
      projects: {
        web: {
          architect: {
            build: {
              builder: "@angular-devkit/build-angular:browser",
              options: { outputPath: "dist/legacy" },
            },
          },
        },
      },
    })
  );
  t.is(resolve_angular_output(dir), "dist/legacy");
  t.is(resolve_angular_output(mkdtempSync(join(tmpdir(), "faable-ng-"))), "dist");
});
