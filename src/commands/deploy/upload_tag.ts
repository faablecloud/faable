import { FaableApi, FaableApp, FaableAppRegistry } from "../../api/FaableApi";
import { log } from "../../log";
import { cmd } from "./cmd";

interface ImageUploadArgs {
  api: FaableApi;
  app: FaableApp;
  tagname: string;
}

export const upload_tag = async (args: ImageUploadArgs) => {
  const { api, app, tagname } = args;
  log.info(`🔁 Uploading...`);

  const registry = await api.getRegistry(app.id);

  // Registry login
  const { user, password, hostname, image } = registry;
  const docker_login_cmd = `echo "${password}" | docker login --username ${user} --password-stdin ${hostname}`;
  await cmd("/bin/bash", ["-c", docker_login_cmd]);

  // Tag image for production
  const image_tag = `${hostname}/${image}`;
  await cmd("docker", ["tag", tagname, image_tag]);

  // Upload the image to faable registry
  await cmd("docker", ["push", image_tag]);
  log.info(`✅ Upload completed.`);
  log.info(`🌍 Deployed on ${app.url}`);
};
