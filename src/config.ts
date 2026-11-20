import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The package's own directory (src/.. in development, dist/.. once built):
// where package.json and the bundled plugin/ live.
export const package_root = path.join(__dirname, "..");
const pkg = fs.readJSONSync(path.join(package_root, "package.json"));
export const version = pkg.version;
