import fs from "fs-extra";
import path from "path";

/**
 * Read the `web:` process command from a Procfile, if present. Returns null when
 * there's no Procfile or no `web` entry. Used as a manual start-command override
 * (Heroku-style) before falling back to framework detection.
 */
export const parse_procfile = (workdir: string): string | null => {
  const procfile = path.join(workdir, "Procfile");
  if (!fs.existsSync(procfile)) return null;

  const content = fs.readFileSync(procfile).toString();
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*web\s*:\s*(.+?)\s*$/);
    if (match?.[1]) return match[1];
  }
  return null;
};
