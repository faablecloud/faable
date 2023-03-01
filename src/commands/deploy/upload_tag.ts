import { FaableAppRegistry } from "../../api/FaableApi";
import { log } from "../../log";
import { cmd } from "./cmd";

interface RegistryUploadConfig {
  registry: FaableAppRegistry;
}

export const upload_tag = async (props: RegistryUploadConfig) => {
  //faablecloud#${ctx.faable_user}+deployment
  const { user, password, hostname, image } = props.registry;

  // Registry login
  const docker_login_cmd = `echo "${password}" | docker login --username ${user} --password-stdin ${hostname}`;
  await cmd("/bin/bash", ["-c", docker_login_cmd]);

  // Tag image for production
  const image_tag = `${hostname}/${image}`;
  await cmd("docker", ["tag", "app", image_tag]);

  // Upload the image to faable registry
  await cmd("docker", ["push", image_tag]);
};
