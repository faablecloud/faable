import axios from "axios";
import { readFileSync } from "fs";
import * as path from "path";
import { FaableApi } from "../../../api/FaableApi";
import { log } from "../../../log";
import { ManifestFile } from "./manifest";

const PUT_CONCURRENCY = 8;
const PUT_RETRIES = 2;

/**
 * Delta upload to the CAS: ask the API which blobs are missing and PUT only
 * those (presigned URLs, sha256-pinned by the signature — S3 rejects content
 * that doesn't match). Redeploys upload just what changed.
 */
export const upload_missing_blobs = async (
  api: FaableApi,
  app_id: string,
  workdir: string,
  manifest: ManifestFile[]
): Promise<{ uploaded: number; bytes: number }> => {
  const { uploads } = await api.uploadMissing(app_id, manifest);
  if (uploads.length === 0) {
    log.info(`📦 Source already in the build store (0 files to upload)`);
    return { uploaded: 0, bytes: 0 };
  }

  // First path wins per sha — content is identical by definition.
  const by_sha = new Map<string, ManifestFile>();
  for (const file of manifest) {
    if (!by_sha.has(file.sha)) by_sha.set(file.sha, file);
  }

  let bytes = 0;
  let queue = 0;
  const worker = async (): Promise<void> => {
    while (queue < uploads.length) {
      const upload = uploads[queue++];
      const file = by_sha.get(upload.sha);
      if (!file) continue; // server echoed a sha we didn't send — ignore
      const body = readFileSync(path.join(workdir, file.path));
      let attempt = 0;
      for (;;) {
        try {
          await axios.put(upload.url, body, {
            headers: {
              ...upload.headers,
              "content-type": "application/octet-stream",
            },
            maxBodyLength: Infinity,
            timeout: 120_000,
          });
          bytes += body.length;
          break;
        } catch (error: any) {
          if (attempt++ >= PUT_RETRIES) {
            throw new Error(
              `Upload failed for ${file.path}: ${error?.message}`,
              { cause: error }
            );
          }
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PUT_CONCURRENCY, uploads.length) }, worker)
  );

  log.info(
    `📤 Uploaded ${uploads.length} changed files (${(bytes / 1024).toFixed(0)} KB) — delta only`
  );
  return { uploaded: uploads.length, bytes };
};
