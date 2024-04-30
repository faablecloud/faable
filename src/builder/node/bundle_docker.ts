import { log } from "../../log";
import { cmd } from "../../lib/cmd";
import fs from "fs-extra";
import Handlebars from "handlebars";
import * as path from "path";
import { fileURLToPath } from "url";
import { FaableApp } from "../../api/FaableApi";
import { Configuration } from "../../lib/Configuration";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates_dir = path.join(__dirname, "templates");
const dockerfile = fs.readFileSync(`${templates_dir}/Dockerfile`).toString();
const entrypoint = fs
  .readFileSync(`${templates_dir}/entrypoint.sh`)
  .toString("utf-8");

Handlebars.registerHelper("escape", function (variable) {
  //const escaped_quotes = variable.replace(/(['"])/g, "\\$1");
  const escaped_lines = variable
    .replace(/(['`\\])/g, "\\$1")
    .replace(/([$])/g, "\\$1");
  return escaped_lines.split("\n").join("\\n");
  //return escaped_lines.split("\n").join("\\n");
});
// Docker template file
const docker_template = Handlebars.compile(dockerfile);
const entrypoint_template = Handlebars.compile(entrypoint);

interface BuildConfig {
  app: FaableApp;
  workdir: string;
  template_context: {
    from: string;
  };
}

export const bundle_docker = async (props: BuildConfig) => {
  const { app, workdir, template_context } = props;

  const entrypoint_custom = entrypoint_template(template_context);
  const start_command = Configuration.instance().startCommand;
  log.info(`⚙️ Start command: ${start_command}`);
  const dockerfile = docker_template({
    from: template_context.from,
    entry_script: entrypoint_custom,
    start_command,
  });

  log.info(`📦 Packaging inside a docker image`);

  // Build options
  const timeout = 10 * 60 * 1000; // 10 minute timeout

  await cmd(
    `docker build -t ${app.id} ${workdir} -f -<<EOF\n${dockerfile}\nEOF`,
    { timeout, enableOutput: true }
  );
};
