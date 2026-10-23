// Adds the Firebase settings for push notifications when the file is there (Firebase console › Project settings ›
// Your apps › Android, package in.peoplecore.app › google-services.json). It isn't committed; without it the app builds
// and runs as before, and Account settings says notifications aren't available in this version.
// Also stamps the build with its commit and time, which Account settings shows, so anyone can tell which build they have.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function commit() {
  if (process.env.EAS_BUILD_GIT_COMMIT_HASH) return process.env.EAS_BUILD_GIT_COMMIT_HASH.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const firebase = fs.existsSync(path.resolve(__dirname, file));
  return {
    ...config,
    extra: { ...config.extra, build: { commit: commit(), builtAt: new Date().toISOString() } },
    android: { ...config.android, ...(firebase ? { googleServicesFile: file } : {}) },
  };
};
