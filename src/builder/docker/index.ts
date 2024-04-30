import { cmd } from "../../lib/cmd";
import { Builder } from "../Builder";

export const builder: Builder = async (ctx) => {
  const { app } = ctx;
  await cmd(`docker build -t ${app.id} .`, {
    enableOutput: true,
  });

  return { type: "docker" };
};

export default builder;
