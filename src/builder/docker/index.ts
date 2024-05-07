import { Builder } from "../Builder";
import path from "path";
import fs from "fs-extra";

export const builder: Builder = async (ctx) => {
  const { app, workdir } = ctx;
  const f = path.join(path.resolve(workdir), "Dockerfile");
  return { dockerfile: (await fs.readFile(f)).toString() };
};

export default builder;
