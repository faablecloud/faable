import { log } from "../../log";
import { cmd } from "./cmd";

interface BuildConfig {
  app_name: string;
  workdir: string;
}

export const build_docker = async (props: BuildConfig) => {
  const { app_name, workdir } = props;
  //log.info("Building...");
  await cmd("/bin/bash", [
    "-c",
    `docker build -t app ${workdir} -f .faable/Dockerfile`,
  ]);
  log.info(`✅ Build ${app_name} successful`);
};
