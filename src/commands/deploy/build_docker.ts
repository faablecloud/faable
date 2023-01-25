import { log } from "../../log";
import { cmd } from "./cmd";
import fs from "fs-extra";
import Handlebars from "handlebars";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates_dir = path.join(__dirname, "../../../templates");
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
  app_name: string;
  workdir: string;
  template_context: {
    from: string;
    build_script: string;
    start_script: string;
  };
}

export const build_docker = async (props: BuildConfig) => {
  const { app_name, workdir, template_context } = props;

  const entrypoint_custom = entrypoint_template(template_context);
  const dockerfile = docker_template({
    ...template_context,
    entry_script: entrypoint_custom,
  });
  // console.log(dockerfile);

  await cmd(
    "/bin/bash",
    ["-c", `docker build -t app ${workdir} -f-<<EOF\n${dockerfile}\nEOF`],
    { enableOutput: true }
  );
};
