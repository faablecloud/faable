import test from "ava";
import { oidc_strategy } from "./oidc.strategy";

test("GitLab keyless deploys need --app, before any request", async (t) => {
  const strategy = oidc_strategy({ idToken: "tok", provider: "gitlab" });
  const err = await t.throwsAsync(() => strategy.headers());
  t.regex(err!.message, /faable deploy --app/);
});
