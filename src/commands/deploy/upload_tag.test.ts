import test from "ava";
import {
  build_upload_tagname,
  pin_tag_to_digest,
  strip_image_tag,
} from "./upload_tag";

const ECR = "439102239196.dkr.ecr.eu-west-3.amazonaws.com";

test("build_upload_tagname tags by deployment id", (t) => {
  t.is(
    build_upload_tagname(ECR, "deploy/app_66f53552", "dep_abc123"),
    `${ECR}/deploy/app_66f53552:dep_abc123`
  );
});

test("strip_image_tag removes the tag", (t) => {
  t.is(
    strip_image_tag(`${ECR}/deploy/app_66f53552:dep_abc123`),
    `${ECR}/deploy/app_66f53552`
  );
});

test("strip_image_tag keeps registry ports intact", (t) => {
  t.is(
    strip_image_tag("localhost:5000/deploy/app_1:dep_1"),
    "localhost:5000/deploy/app_1"
  );
  t.is(strip_image_tag("localhost:5000/deploy/app_1"), "localhost:5000/deploy/app_1");
});

test("strip_image_tag is a no-op without tag", (t) => {
  t.is(strip_image_tag(`${ECR}/deploy/app_1`), `${ECR}/deploy/app_1`);
});

test("pin_tag_to_digest grafts the digest onto the tagged ref", (t) => {
  const tag = `${ECR}/deploy/app_1:dep_9`;
  const digest =
    "sha256:6c3c624b58dbbcd3c0dd82b4c53f04194d1247c6eebdaab7c610cf7d66709b3b";
  t.is(
    pin_tag_to_digest(tag, [`${ECR}/deploy/app_1@${digest}`]),
    `${tag}@${digest}`
  );
});

test("pin_tag_to_digest picks the digest of this repo among several", (t) => {
  const tag = `${ECR}/deploy/app_1:dep_9`;
  const digest = "sha256:aaaa";
  const digests = [
    "ghcr.io/faable/app_1@sha256:bbbb", // other registry
    `${ECR}/deploy/app_2@sha256:cccc`, // other repo
    `${ECR}/deploy/app_1@${digest}`,
  ];
  t.is(pin_tag_to_digest(tag, digests), `${tag}@${digest}`);
});

test("pin_tag_to_digest returns null when no digest matches the repo", (t) => {
  const tag = `${ECR}/deploy/app_1:dep_9`;
  t.is(pin_tag_to_digest(tag, ["ghcr.io/faable/app_1@sha256:bbbb"]), null);
  t.is(pin_tag_to_digest(tag, []), null);
});

test("pin_tag_to_digest does not substring-match repo prefixes", (t) => {
  // deploy/app_1 must not match deploy/app_12's digest
  const tag = `${ECR}/deploy/app_1:dep_9`;
  t.is(
    pin_tag_to_digest(tag, [`${ECR}/deploy/app_12@sha256:dddd`]),
    null
  );
});
