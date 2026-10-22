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
