# Android app: building and installing

The team installs the phone app from **https://hrms.tazq.io/android**: a public page with the Download button, the
version, a QR code (to open the page on a phone from a computer) and how to install. Nothing secret goes into the app: it
uses the same public (publishable) key as the website, and RLS decides what each person sees.

## Publishing a new version (from the Mac)

```sh
cd ~/Projects/peoplecore && git pull
deploy/publish-android.sh
```

Like `deploy/ship.sh`, it refuses unless HEAD is `origin/main` and CI passed on it (`--force` skips that, for
emergencies). In 10 to 20 minutes it:

1. builds the app from scratch (`expo prebuild --clean`, `gradlew assembleRelease`) for phones only (no x86, about half
   the size), signed with the release key and with push notifications (`~/.peoplecore/android/google-services.json`,
   or `GOOGLE_SERVICES_JSON`);
2. points it at the website's Supabase project, read from the server's `/opt/peoplecore/.env` (a local
   `apps/mobile/.env` is ignored), and checks the built app really contains that address;
3. refuses a debug-signed build, a build signed with another key than the published one, or a version that isn't newer
   (the version is the commit count, so commit something first);
4. uploads it to `/opt/peoplecore/downloads/android/PeopleCore-<version>.apk` on the server with `latest.json`
   describing it (the newest three builds are kept), and checks that /android offers it.

The web container reads that folder directly, so a new phone version needs no website deploy. If a phone change
needs new website code (an `/api/mobile` route, a page it opens), ship the website first: phones update over days.

**What the team does:** open the link on the phone, Download, open the file and Install (the page explains Chrome's
warning, allowing installs from the browser once, and Play Protect). Later versions: the app shows **Update
PeopleCore** on Home (it asks the website at most once an hour); they tap it and install over the old one, staying
signed in. Builds older than the first one with this check (2 Nov 2026) have to be updated once by hand from the page.

**Going back:** Android won't install a lower version over a higher one, so there is no rollback for phones: fix
forward and publish again.

**The Mac needs:** the release signing key (`PEOPLECORE_UPLOAD_*` in `~/.gradle/gradle.properties`, see
BUILD_STATUS.md › Android release signing), `~/.peoplecore/android/google-services.json`, the Android SDK in
`~/Library/Android/sdk` (or `ANDROID_HOME`), Java 17 and SSH access to the server.

## Building in Expo's cloud instead (EAS Build, not set up)

The app can also be built in Expo's cloud. That needs a free Expo account once; after that, each new version is one
command.

### Once

1. Create a free account at https://expo.dev/signup.
2. On the Mac, in the project:

   ```sh
   cd ~/Projects/peoplecore/apps/mobile
   npx eas-cli@latest login
   npx eas-cli@latest init          # links this app to your Expo account; commit the projectId it adds to app.json
   ```

3. Tell the builds which server to use (values from Vercel's `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; both are public by design):

   ```sh
   for env in preview production; do
     npx eas-cli@latest env:create --environment $env --name EXPO_PUBLIC_SUPABASE_URL --value "https://<project>.supabase.co" --visibility plaintext
     npx eas-cli@latest env:create --environment $env --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "<publishable key>" --visibility plaintext
     npx eas-cli@latest env:create --environment $env --name EXPO_PUBLIC_SITE_URL --value "https://hrms.tazq.io" --visibility plaintext
   done
   ```

### Each version: an installable APK

```sh
cd ~/Projects/peoplecore/apps/mobile
npx eas-cli@latest build --platform android --profile preview
```

It takes 10 to 20 minutes and ends with a link and a QR code. EAS signs with its own key unless given PeopleCore's,
and only builds with the same key can update apps installed from /android.

### Google Play (later)

`--profile production` builds the bundle Google Play wants; `npx eas-cli@latest submit --platform android` uploads it.
That needs a Google Play developer account (a one-time fee) and the store listing.

## What the app needs from the server

The live Supabase project's Auth › URL configuration must allow `https://hrms.tazq.io/auth/callback?**` (the same entry
the website's invitations use): the phone's "Forgot password?" link opens the website to choose the new password.

## Push notifications (once)

The phone gets a notification for each in-app notification (approvals waiting, decisions on your requests,
payslips, …) through Firebase Cloud Messaging. Until the two pieces below exist, the app doesn't ask for permission and
Account settings says notifications aren't available in this version; nothing else changes.

1. In the Firebase console (https://console.firebase.google.com) create a project (Google Analytics is not needed).
2. **For the app:** Project settings › General › Your apps › add an Android app with the package `in.peoplecore.app`.
   Download `google-services.json` and put it at `apps/mobile/google-services.json` (it is git-ignored), or point
   `GOOGLE_SERVICES_JSON` at it when building. Build the app again; it now asks for permission at the first sign-in.
   For EAS builds, upload it as a file variable: `npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret`.
3. **For the server:** Project settings › Service accounts › Generate new private key. Put the downloaded JSON in the
   worker's environment as `FCM_SERVICE_ACCOUNT` (one line, or base64: `base64 -i key.json`), in `/opt/peoplecore/.env`
   on the server, then restart the worker (`deploy/ship.sh` does). The worker logs `"push":true` when it starts.
   This key can send notifications to the app's users: keep it only on the server.

**Set up on 2026-10-23:** Firebase project `peoplecore-hrms` (owner's Google account; separate from every other app),
Android app `in.peoplecore.app`. The worker sends as `peoplecore-push@peoplecore-hrms.iam.gserviceaccount.com`, which
holds only the Firebase Cloud Messaging Admin role; its key lives only in the server's `.env` (added 2026-10-24; the worker logs `"push":true`). To replace the key, make
a new one for that account (Google Cloud console › IAM › Service accounts › Keys), put it in `.env`, restart the worker,
then delete the old key there.

Each person can switch notifications off for their phone under Me › Notifications. Signing out stops notifications to that
phone. A notification nobody could deliver within a day is dropped (the Inbox still shows it).
