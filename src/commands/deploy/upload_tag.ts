import { log } from "../../log";
import { cmd } from "./cmd";

interface RegistryUploadConfig {
  app_name: string;
  hostname?: string;
  user: string; // faablecloud#<user>+deployment
  password: string;
}

export const upload_tag = async (props: RegistryUploadConfig) => {
  const {
    hostname = "harbor.app.faable.com",
    user,
    password,
    app_name,
  } = props;

  const tag = `${hostname}/${user}/${app_name}`;

  // Registry login
  await cmd("/bin/bash", [
    "-c",
    `echo "${password}" | docker login --username ${user} --password-stdin ${hostname}`,
  ]);
  log.info(`Logged in ${user}`);

  // Tag image for production
  await cmd("docker", ["tag", "app", tag]);
  log.info(`Tagged image ${tag}`);

  // Upload the image to faable registry
  await cmd("docker", ["push", tag]);
  log.info(`Uploaded ${tag}`);
};
