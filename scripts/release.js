import { spawnSync } from 'child_process';

// Get a copy of the current environment
const env = { ...process.env };

// Strip out ALL npm environment variables injected by `npm run` or `npx`
for (const key in env) {
  if (key.startsWith('npm_')) {
    delete env[key];
  }
}

console.log('[faable-release] Spawning semantic-release in a clean environment...');

// Spawn semantic-release securely
const result = spawnSync('node', ['./node_modules/semantic-release/bin/semantic-release.js'], {
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
