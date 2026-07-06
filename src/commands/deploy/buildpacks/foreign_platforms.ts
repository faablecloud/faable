/**
 * Config files from other deployment platforms. Recognizing them turns the
 * detection-failure error from "nothing found" into "this repo is set up for
 * X — Faable can't use that file directly". cerebrium.toml is deliberately
 * absent (it has a real provider); Procfile too (it's a Faable input).
 */
export const FOREIGN_PLATFORMS: Record<string, string> = {
  "cog.yaml": "Replicate",
  "fly.toml": "Fly.io",
  "render.yaml": "Render",
  "vercel.json": "Vercel",
  "now.json": "Vercel",
  "netlify.toml": "Netlify",
  "app.yaml": "Google App Engine",
  "railway.json": "Railway",
  "railway.toml": "Railway",
  "heroku.yml": "Heroku",
  "captain-definition": "CapRover",
};
