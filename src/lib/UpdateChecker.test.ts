import test from "ava";
import { isCacheStale, isDevBuild, isNewerVersion } from "./UpdateChecker";

test("detects newer patch, minor and major versions", (t) => {
  t.true(isNewerVersion("1.9.1", "1.9.0"));
  t.true(isNewerVersion("1.10.0", "1.9.9"));
  t.true(isNewerVersion("2.0.0", "1.99.99"));
});

test("equal or older versions are not upgrades", (t) => {
  t.false(isNewerVersion("1.9.0", "1.9.0"));
  t.false(isNewerVersion("1.8.9", "1.9.0"));
  t.false(isNewerVersion("1.9.0", "2.0.0"));
});

test("a release is newer than its own prerelease", (t) => {
  t.true(isNewerVersion("1.9.0", "1.9.0-beta.1"));
  t.false(isNewerVersion("1.9.0-beta.1", "1.9.0"));
});

test("tolerates v prefixes and malformed versions", (t) => {
  t.true(isNewerVersion("v1.9.1", "1.9.0"));
  t.false(isNewerVersion("not-a-version", "1.9.0"));
});

test("identifies the semantic-release dev placeholder", (t) => {
  t.true(isDevBuild("0.0.0-development"));
  t.false(isDevBuild("1.9.0"));
});

test("cache is stale when missing, malformed or older than a day", (t) => {
  const now = new Date("2026-07-08T12:00:00Z").getTime();
  t.true(isCacheStale({}, now));
  t.true(isCacheStale({ last_check: "not-a-date" }, now));
  t.true(isCacheStale({ last_check: "2026-07-07T11:00:00Z" }, now));
  t.false(isCacheStale({ last_check: "2026-07-08T11:00:00Z" }, now));
  t.false(isCacheStale({ last_check: "2026-07-07T12:30:00Z" }, now));
});
