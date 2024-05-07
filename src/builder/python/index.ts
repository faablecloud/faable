import { Builder } from "../Builder";
import fs from "fs-extra";
import path from "path";
import { prepare_dockerfile } from "./prepare_dockerfile";

export const builder: Builder = async (ctx) => {
  const { workdir, log } = ctx;

  const hasRequirements = fs.existsSync(
    path.join(path.resolve(workdir), "requirements.txt")
  );

  if (!hasRequirements) {
    throw new Error(`Missing requirements.txt`);
  }

  const { dockerfile } = await prepare_dockerfile(ctx);
  return {
    dockerfile,
  };
};

export default builder;
