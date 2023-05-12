import test from "ava";
import { cmd } from "./cmd";

test("cmd git", async (t) => {
  const version = await cmd("git --version");
  t.pass();
});
