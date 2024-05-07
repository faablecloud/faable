import test from "ava";
import { cmd } from "./cmd";

const build = (dir: string) => {
  return cmd(
    `node ../pkg/bin/faable.js -w ${dir} deploy --onlybuild kirbic-web`,
    {
      enableOutput: true,
    }
  );
};

test.serial("node", async (t) => {
  await build("../examples/node-express");
  return t.pass();
});

test.serial("next", async (t) => {
  await build("../examples/nextjs");
  return t.pass();
});

test.serial("docker", async (t) => {
  await build("../examples/docker-node");
  return t.pass();
});

test.serial("python", async (t) => {
  await build("../examples/python-fastapi");
  return t.pass();
});
