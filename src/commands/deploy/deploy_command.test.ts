import test from "ava";
import { deploy_command } from "./deploy_command";

test("deploy app", async (t) => {
  t.timeout(10 * 60 * 1000);
  await deploy_command({
    app_slug: "landing",
  });
  t.pass();
});
