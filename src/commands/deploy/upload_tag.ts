import { FaableApi, FaableApp } from "../../api/FaableApi";
import { log } from "../../log";
import { cmd } from "../../lib/cmd";

interface ImageUploadArgs {
  api: FaableApi;
  app: FaableApp;
  /** Deployment being built — its id becomes the immutable image tag. */
  deployment_id: string;
}

/**
 * `<hostname>/<image>:<deployment_id>` — one tag per build, never
 * overwritten. Without a tag docker resolves `:latest`, which every deploy
 * rewrites: any rescheduled pod (node drain, eviction) would silently pull
 * whatever build was pushed last, breaking the deployment ↔ code identity.
 */
export const build_upload_tagname = (
  hostname: string,
  image: string,
  deployment_id: string
) => `${hostname}/${image}:${deployment_id}`;

/**
 * Strips the tag from an image ref, keeping registry ports intact
 * (`host:5000/img:tag` → `host:5000/img`). A colon only denotes a tag when
 * it appears after the last path segment separator.
 */
export const strip_image_tag = (ref: string): string => {
  const last_slash = ref.lastIndexOf("/");
  const last_colon = ref.lastIndexOf(":");
  return last_colon > last_slash ? ref.slice(0, last_colon) : ref;
};

/**
 * Pins a pushed tag to its content digest: `repo:tag@sha256:…`. Kubernetes
 * pulls by digest (immutable even if the tag were re-pushed); the tag stays
 * as the human-readable label. `RepoDigests` entries come as `repo@sha256:…`
 * (no tag) and may reference other registries — only the entry for this
 * repo counts. Returns null when none matches (caller falls back to the tag).
 */
export const pin_tag_to_digest = (
  tagname: string,
  repo_digests: string[]
): string | null => {
  const repo = strip_image_tag(tagname);
  const match = repo_digests.find((d) => d.startsWith(`${repo}@sha256:`));
  if (!match) return null;
  return `${tagname}@${match.slice(repo.length + 1)}`;
};

export const upload_tag = async (args: ImageUploadArgs) => {
  const { api, app, deployment_id } = args;
  log.info(`🔁 Uploading...`);

  const registry = await api.getRegistry(app.id);

  // Registry login
  const { user, password, hostname, image } = registry;

  await cmd(
    `echo "${password}" | docker login --username "${user}" --password-stdin ${hostname}`
  );

  // Tag the local build (tagged `app.id` by the buildpack) for this version
  const upload_tagname = build_upload_tagname(hostname, image, deployment_id);
  await cmd(`docker tag ${app.id} ${upload_tagname}`);

  // Upload the image to faable registry
  await cmd(`docker push ${upload_tagname}`);

  // Pin to the digest the registry just assigned. Best-effort: the tagged
  // ref alone is already unique per build, the digest just makes it
  // tamper-proof.
  let image_ref = upload_tagname;
  try {
    const inspect = await cmd(
      `docker inspect --format '{{json .RepoDigests}}' ${upload_tagname}`
    );
    const repo_digests: string[] = JSON.parse(String(inspect.stdout).trim());
    const pinned = pin_tag_to_digest(upload_tagname, repo_digests);
    if (pinned) {
      image_ref = pinned;
    } else {
      log.warn(`Could not resolve the pushed digest; deploying by tag only.`);
    }
  } catch (error: any) {
    log.warn(
      `Could not inspect the pushed image (${error.message}); deploying by tag only.`
    );
  }

  log.info(`✅ Upload completed.`);

  return {
    upload_tagname,
    /** Immutable ref recorded on the deployment: `repo:tag@sha256:…` */
    image_ref,
  };
};
