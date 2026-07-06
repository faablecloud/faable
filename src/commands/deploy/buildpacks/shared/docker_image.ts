import fs from "fs-extra";
import Handlebars from "handlebars";
import * as path from "path";
import { fileURLToPath } from "url";
import { FaableApp } from "../../../../api/FaableApi";
import { cmd } from "../../../../lib/cmd";
import { log } from "../../../../log";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates_dir = path.join(__dirname, "templates");
const dockerfile_source = fs
  .readFileSync(path.join(templates_dir, "Dockerfile"))
  .toString();
const entrypoint_source = fs
  .readFileSync(path.join(templates_dir, "entrypoint.sh"))
  .toString("utf-8");

// Backslash-escape content so it survives BOTH the unquoted bash heredoc the
// Dockerfile is piped through (docker build -f -<<EOF) and, for the entry
// script, the single-quoted `RUN echo '...'`.
Handlebars.registerHelper("escape", function (variable: string) {
  const escaped_lines = variable
    .replace(/(['`\\])/g, "\\$1")
    .replace(/([$])/g, "\\$1");
  return escaped_lines.split("\n").join("\\n");
});

const docker_template = Handlebars.compile(dockerfile_source);
const entrypoint_template = Handlebars.compile(entrypoint_source);

export interface RenderParams {
  /** Base image without distro suffix (e.g. "node:22.1.0"); `-slim` is appended here. */
  from: string;
  /** Buildpack-specific ENV block (PORT=80 is always set by the template). */
  env: Record<string, string>;
  /** Buildpack-specific entrypoint banner (version echo lines). */
  banner: string;
  start_command: string;
  install_command?: string;
  /** Manifests copied before the install RUN (cacheable dependency layer). */
  install_files?: string[];
}

/** Pure render of the final Dockerfile contents — snapshot-tested. */
export const render_dockerfile = (params: RenderParams): string => {
  // NOTE: use slim to build projects
  const from = [params.from, "slim"].filter((e) => e).join("-");
  const entry_script = entrypoint_template({ banner: params.banner });
  return docker_template({
    from,
    env: params.env,
    entry_script,
    start_command: params.start_command,
    install_command: params.install_command,
    install_files: params.install_files,
  });
};

export const build_image = async (props: {
  app: FaableApp;
  workdir: string;
  dockerfile: string;
}): Promise<void> => {
  const { app, workdir, dockerfile } = props;
  log.info(`📦 Packaging inside a docker image`);
  const timeout = 10 * 60 * 1000; // 10 minute timeout
  await cmd(
    `docker build --platform linux/amd64 -t ${app.id} ${workdir} -f -<<EOF\n${dockerfile}\nEOF`,
    { timeout, enableOutput: true }
  );
};
