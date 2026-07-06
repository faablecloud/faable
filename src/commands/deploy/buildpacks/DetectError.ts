import fs from "fs-extra";
import path from "path";
import { Buildpack } from "./Buildpack";
import { FOREIGN_PLATFORMS } from "./foreign_platforms";

const DOCS_URL = "https://faable.com/docs/deploy/build-requirements";
const MAX_LISTED_FILES = 20;

export interface BuildpackDiagnostic {
  buildpack: string;
  looked_for: string[];
  /** Weak-signal trigger files of the fallback pass, when the buildpack has one. */
  fallback?: string[];
}

/** Workdir listing for diagnostics: dirs suffixed "/", noise skipped, capped. */
const list_found_files = (workdir: string): string[] => {
  try {
    return fs
      .readdirSync(workdir, { withFileTypes: true })
      .filter((e) => ![".git", "node_modules"].includes(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort()
      .slice(0, MAX_LISTED_FILES);
  } catch {
    return [];
  }
};

const render_message = (props: {
  workdir: string;
  diagnostics: BuildpackDiagnostic[];
  found_files: string[];
  foreign: { file: string; platform: string }[];
}): string => {
  const pad = Math.max(
    ...props.diagnostics.map((d) => d.buildpack.length + 11)
  );
  const looked = props.diagnostics
    .flatMap((d) => {
      const lines = [
        `  ${d.buildpack.padEnd(pad)} → ${d.looked_for.join(", ")}`,
      ];
      if (d.fallback?.length) {
        lines.push(
          `  ${`${d.buildpack} (fallback)`.padEnd(pad)} → ${d.fallback.join(", ")}`
        );
      }
      return lines;
    })
    .join("\n");

  const found =
    props.found_files.length > 0
      ? `\n\nFiles found in ${props.workdir}:\n  ${props.found_files.join(", ")}`
      : `\n\nNo files found in ${props.workdir}.`;

  const foreign =
    props.foreign.length > 0
      ? `\n\nFound config for another platform:\n${props.foreign
          .map(
            (f) =>
              `  ${f.file} → ${f.platform} — Faable can't use it directly.`
          )
          .join("\n")}`
      : "";

  return (
    `Cannot detect how to build this project.\n\n` +
    `Faable looked for (in order):\n${looked}` +
    found +
    foreign +
    `\n\nFix: add one of the files above, or force a buildpack with "buildpack" in faable.json or --buildpack.\n` +
    `Docs: ${DOCS_URL}`
  );
};

/**
 * Thrown by the registry when no buildpack claims the project. The full
 * multi-line diagnostic lives in `message`, so the CLI's standard error path
 * (yargs .fail → log.error → exit 1) prints it without special handling.
 */
export class DetectError extends Error {
  readonly workdir: string;
  readonly diagnostics: BuildpackDiagnostic[];
  readonly found_files: string[];
  readonly foreign: { file: string; platform: string }[];

  constructor(workdir: string, buildpacks: Buildpack[]) {
    const diagnostics = buildpacks.map((b) => ({
      buildpack: b.name,
      looked_for: b.detect_files,
      ...(b.fallback_files ? { fallback: b.fallback_files } : {}),
    }));
    const found_files = list_found_files(workdir);
    const foreign = Object.entries(FOREIGN_PLATFORMS)
      .filter(([file]) => fs.existsSync(path.join(workdir, file)))
      .map(([file, platform]) => ({ file, platform }));

    super(render_message({ workdir, diagnostics, found_files, foreign }));
    this.name = "DetectError";
    this.workdir = workdir;
    this.diagnostics = diagnostics;
    this.found_files = found_files;
    this.foreign = foreign;
  }
}
