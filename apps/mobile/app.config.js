// Adds the Firebase settings for push notifications when the file is there (Firebase console › Project settings ›
// Your apps › Android, package in.peoplecore.app › google-services.json). It isn't committed; without it the app builds
// and runs as before, and Account settings says notifications aren't available in this version.
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  if (!fs.existsSync(path.resolve(__dirname, file))) return config;
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};
