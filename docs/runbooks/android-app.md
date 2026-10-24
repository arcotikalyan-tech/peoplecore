# Android app: building and installing

The phone app (`apps/mobile`, Expo) is built in Expo's cloud (EAS Build). You need a free Expo account once; after
that, each new version is one command. Nothing secret goes into the app: it uses the same public (publishable) key
as the website, and RLS decides what each person sees.

## Once

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

## Each version: an installable APK (testing, or sharing with your team)

```sh
cd ~/Projects/peoplecore/apps/mobile
npx eas-cli@latest build --platform android --profile preview
```

It takes 10 to 20 minutes and ends with a link and a QR code. Open the link on an Android phone, download the APK and
install it (Android asks once to allow installs from the browser). Anyone with the link can install it.

## Google Play (later)

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

Each person can switch notifications off for their phone in Account settings. Signing out stops notifications to that
phone. A notification nobody could deliver within a day is dropped (the Inbox still shows it).
