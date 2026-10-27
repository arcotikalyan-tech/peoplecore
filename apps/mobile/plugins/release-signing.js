// Release builds are signed with PeopleCore's own key when this machine has it (Gradle properties
// PEOPLECORE_UPLOAD_STORE_FILE, …_KEY_ALIAS, …_STORE_PASSWORD, …_KEY_PASSWORD, kept in ~/.gradle/gradle.properties, never
// in the repo). Without them a release build still uses the debug key, as before, so anyone can build to test; only
// builds signed with the release key can update an installed release.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// PeopleCore release signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let gradle = c.modResults.contents;
    if (gradle.includes(MARK)) return c;
    gradle = gradle.replace(
      /signingConfigs \{\n(\s+)debug \{/,
      (match, indent) => `signingConfigs {\n${indent}${MARK}\n${indent}if (project.hasProperty('PEOPLECORE_UPLOAD_STORE_FILE')) {\n`
        + `${indent}    release {\n`
        + `${indent}        storeFile file(PEOPLECORE_UPLOAD_STORE_FILE)\n`
        + `${indent}        storePassword PEOPLECORE_UPLOAD_STORE_PASSWORD\n`
        + `${indent}        keyAlias PEOPLECORE_UPLOAD_KEY_ALIAS\n`
        + `${indent}        keyPassword PEOPLECORE_UPLOAD_KEY_PASSWORD\n`
        + `${indent}    }\n${indent}}\n${indent}debug {`,
    );
    gradle = gradle.replace(
      /(release \{\n(?:\s*\/\/.*\n)*\s+)signingConfig signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('PEOPLECORE_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );
    if (!gradle.includes("signingConfigs.release : signingConfigs.debug")) {
      throw new Error('release-signing: the generated build.gradle changed shape; update plugins/release-signing.js');
    }
    c.modResults.contents = gradle;
    return c;
  });
};
