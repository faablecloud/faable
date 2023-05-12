import { FaableApi, FaableApp, FaableAppRegistry } from "../../api/FaableApi";
import { log } from "../../log";
import { cmd } from "../../lib/cmd";

interface ImageUploadArgs {
  api: FaableApi;
  app: FaableApp;
}

export const upload_tag = async (args: ImageUploadArgs) => {
  const { api, app } = args;
  log.info(`🔁 Uploading...`);

  const registry = await api.getRegistry(app.id);

  // Registry login
  const { user, password, hostname, image } = registry;

  await cmd(
    `echo "${password}" | docker login --username ${user} --password-stdin ${hostname}`
  );

  // Tag image for production
  const upload_tagname = `${hostname}/${image}`;
  await cmd(`docker tag ${app.id} ${upload_tagname}`);

  // Upload the image to faable registry
  await cmd(`docker push ${upload_tagname}`);
  log.info(`✅ Upload completed.`);

  return {
    upload_tagname,
  };
};
