#!/usr/bin/env bash
# Builds the Android app from the current commit and publishes it at https://hrms.tazq.io/android, where the team
# downloads it and the installed apps find the update (Home › Update PeopleCore). See docs/runbooks/android-app.md.
#   deploy/publish-android.sh            # refuses unless the commit is pushed and CI passed on it
#   deploy/publish-android.sh --force    # skips the CI check (emergencies only)
# Needs this Mac's release signing key (PEOPLECORE_UPLOAD_* in ~/.gradle/gradle.properties): only builds signed with it
# can update the installed apps. The app talks to the website's own Supabase project, read from the server's .env.
set -euo pipefail
HOST="${PEOPLECORE_SERVER:-root@187.127.120.22}"
SITE="${PEOPLECORE_SITE:-https://hrms.tazq.io}"
DIR=/opt/peoplecore/downloads/android # mounted into the web container (deploy/docker-compose.yml)
KEEP=3 # builds kept on the server, newest first
cd "$(git rev-parse --show-toplevel)"
. deploy/ci.sh

[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes; commit first." >&2; exit 1; }
[ "${1:-}" = "--force" ] || require_green_main

grep -q '^PEOPLECORE_UPLOAD_STORE_FILE=' ~/.gradle/gradle.properties 2>/dev/null \
  || { echo "This Mac doesn't have PeopleCore's release signing key (BUILD_STATUS.md › Android release signing)." >&2; exit 1; }
export GOOGLE_SERVICES_JSON="${GOOGLE_SERVICES_JSON:-$HOME/.peoplecore/android/google-services.json}"
[ -f "$GOOGLE_SERVICES_JSON" ] || { echo "No $GOOGLE_SERVICES_JSON: the app would have no push notifications." >&2; exit 1; }
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
TOOLS=$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)

# The website's Supabase address and publishable key (public by design; RLS decides what each person sees). Only these
# reach the build: EXPO_NO_DOTENV keeps a local apps/mobile/.env, which may point at the local stack, out of it.
LIVE=$(ssh "$HOST" "grep -E '^NEXT_PUBLIC_SUPABASE_(URL|PUBLISHABLE_KEY)=' /opt/peoplecore/.env")
live() { printf '%s\n' "$LIVE" | sed -n "s/^$1=//p" | tr -d "\"'"; }
EXPO_PUBLIC_SUPABASE_URL=$(live NEXT_PUBLIC_SUPABASE_URL)
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(live NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
[ -n "$EXPO_PUBLIC_SUPABASE_URL" ] && [ -n "$EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY" ] || { echo "Couldn't read the live Supabase address and key from the server." >&2; exit 1; }
export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY EXPO_PUBLIC_SITE_URL="$SITE" EXPO_NO_DOTENV=1 CI=1

echo "Building the Android app at $(git rev-parse --short HEAD) (10 to 20 minutes)..."
corepack pnpm install --frozen-lockfile --prefer-offline >/dev/null
(cd apps/mobile && corepack pnpm exec expo prebuild --platform android --clean --no-install >/dev/null)
# Phones only: the x86 libraries are for emulators and would nearly double the download.
(cd apps/mobile/android && ./gradlew assembleRelease -q -PreactNativeArchitectures=armeabi-v7a,arm64-v8a)
APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk

# What ships must reach the live database, be signed with the release key, and be newer than what's published.
# (Counted into a variable: grep writing to /dev/null stops at the first match, and pipefail would fail on unzip.)
HITS=$(unzip -p "$APK" assets/index.android.bundle | grep -a -F -c "$EXPO_PUBLIC_SUPABASE_URL" || true)
[ "${HITS:-0}" -gt 0 ] || { echo "The build doesn't point at $EXPO_PUBLIC_SUPABASE_URL; not publishing." >&2; exit 1; }
CERTS=$("$TOOLS/apksigner" verify --print-certs "$APK")
[[ $CERTS != *"CN=Android Debug"* ]] || { echo "The build is signed with the debug key; installed apps couldn't update to it." >&2; exit 1; }
SIGNER=$(sed -n '/certificate SHA-256 digest: /{s/.*digest: //p;q;}' <<<"$CERTS")
[ -n "$SIGNER" ] || { echo "Couldn't read the build's signing certificate." >&2; exit 1; }
BADGING=$("$TOOLS/aapt2" dump badging "$APK")
CODE=$(sed -n "s/^package: .* versionCode='\([0-9]*\)'.*/\1/p" <<<"$BADGING")
VERSION=$(sed -n "s/^package: .* versionName='\([^']*\)'.*/\1/p" <<<"$BADGING")
PREV=$(ssh "$HOST" "cat $DIR/latest.json 2>/dev/null || true")
read -r PREV_CODE PREV_SIGNER < <(node -e 'const j = JSON.parse(process.argv[1] || "{}"); console.log(j.versionCode || 0, j.signer || "-")' "$PREV")
[ "$CODE" -gt "$PREV_CODE" ] || { echo "Version $CODE isn't newer than the published $PREV_CODE; commit something first." >&2; exit 1; }
[ "$PREV_SIGNER" = "-" ] || [ "$PREV_SIGNER" = "$SIGNER" ] || { echo "Signed with a different key than version $PREV_CODE; installed apps couldn't update." >&2; exit 1; }

NAME="PeopleCore-$CODE.apk"
SIZE=$(stat -f%z "$APK")
MANIFEST=$(node -e '
  const [versionCode, version, commit, file, size, sha256, signer] = process.argv.slice(1);
  console.log(JSON.stringify({ versionCode: +versionCode, version, commit, publishedAt: new Date().toISOString(), file, size: +size, sha256, signer }, null, 2));
' "$CODE" "$VERSION" "$(git rev-parse --short=7 HEAD)" "$NAME" "$SIZE" "$(shasum -a 256 "$APK" | cut -d' ' -f1)" "$SIGNER")

echo "Uploading version $CODE ($((SIZE / 1000000)) MB)..."
ssh "$HOST" "mkdir -p $DIR"
scp -q "$APK" "$HOST:$DIR/$NAME.part"
# The new file is in place before latest.json names it; older builds go last (a download already under way keeps going).
printf '%s\n' "$MANIFEST" | ssh "$HOST" "set -e; cd $DIR; mv $NAME.part $NAME; cat > latest.json.part; mv latest.json.part latest.json
  ls PeopleCore-*.apk | sort -t- -k2 -n -r | tail -n +$((KEEP + 1)) | xargs -r rm -f --"

ONLINE=$(curl -fsS "$SITE/android/latest.json" 2>/dev/null || true)
if [[ $ONLINE == *"\"versionCode\":$CODE,"* ]]; then
  echo "Published version $CODE: $SITE/android"
else
  echo "Version $CODE is on the server, but $SITE/android doesn't offer it yet: run deploy/ship.sh once (it mounts the downloads folder)." >&2
  exit 1
fi
