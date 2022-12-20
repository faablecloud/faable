import * as fs from "fs-extra";
import Handlebars from "handlebars";
import * as path from "path";
import { log } from "../../log";

const templates_dir = path.join(__dirname, "./templates");
const dockerfile = fs.readFileSync(`${templates_dir}/Dockerfile`).toString();

// Docker template file
const docker_template = Handlebars.compile(dockerfile);

interface PrepareBuild {
  from_image: string;
  build_script?: string;
  start_script?: string;
  workdir: string;
}

export const prepare = async (props: PrepareBuild) => {
  const {
    from_image,
    build_script = "build",
    start_script = "start",
    workdir,
  } = props;

  await fs.remove(path.join(workdir, ".faable"));
  await fs.mkdirp(path.join(workdir, ".faable"));

  //log.info(`Preparing Dockerfile`);
  // Compose template with data and write to path
  const composed_file_data = docker_template({
    from_image,
    build_script,
    start_script,
  });

  // Create Dockerfile
  let out = path.join(workdir, ".faable", "Dockerfile");
  await fs.writeFile(out, composed_file_data);
  //log.info(`Created ${out}`);

  // Copy entrypoint file
  let out2 = path.join(workdir, ".faable", "entrypoint.sh");
  await fs.copyFile(path.join(templates_dir, "entrypoint.sh"), out2);
  //log.info(`Created ${out2}`);
};
