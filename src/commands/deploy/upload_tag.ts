import { FaableAppRegistry } from "../../api/faable_api";
import { log } from "../../log";
import { cmd } from "./cmd";

interface RegistryUploadConfig {
  registry: FaableAppRegistry;
}

export const upload_tag = async (props: RegistryUploadConfig) => {
  //faablecloud#${ctx.faable_user}+deployment
  const { user, password, hostname, image } = props.registry;

  // Registry login

  await cmd("/bin/bash", [
    "-c",
    `echo "${password}" | docker login --username ${user} --password-stdin ${hostname}`,
  ]);

  // Tag image for production
  await cmd("docker", ["tag", "app", image]);

  // Upload the image to faable registry
  await cmd("docker", ["push", image]);
};
