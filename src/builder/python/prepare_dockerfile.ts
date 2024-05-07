import fs from "fs-extra";
import Handlebars from "handlebars";
import * as path from "path";
import { fileURLToPath } from "url";
import { BuilderContext } from "builder/Builder";

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

export const prepare_dockerfile = async (
  ctx: BuilderContext,
  params: object = {}
) => {
  const { app, workdir, log, config } = ctx;

  const entrypoint_custom = entrypoint_template(params);
  const start_command = config.getConfigProperty("startCommand");

  if (!start_command) {
    throw new Error(`Missing start command configuration`);
  }

  log.info(`✅ Start command set to "${start_command}"`);
  const dockerfile = docker_template({
    ...params,
    entry_script: entrypoint_custom,
    start_command,
  });

  return { dockerfile };
};
