# PeopleCore mobile (Expo)

The employee app: check in and out with location, request and cancel leave, see payslips. Built with Expo SDK 57
and expo-router. It talks to Supabase as the signed-in person with the **publishable key only**; row-level
security decides what they see, exactly as on the web.

## Run it

```sh
cp .env.example .env          # EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
corepack pnpm --filter @peoplecore/mobile start     # Expo Go or a development build
corepack pnpm --filter @peoplecore/mobile web       # in a browser (no location mocking checks there)
```

Sign in with a PeopleCore account. People whose roles need two-step verification (owner, HR, payroll) enter
their authenticator code. They set it up on the web first.

## Check-in

- A punch is saved on the phone first, with a client id made once (`src/lib/punch-queue.ts`). It is sent to
  `record_punch` (method `mobile`) when there is a connection, and again whenever the phone comes back online.
- The database records each client id once and accepts offline punches up to 72 hours old, so nothing is
  counted twice or lost.
- Location: permission is asked when you first check in. Mock locations (which Android reports) are refused,
  and so are fixes rougher than 500 m. The office geofence is checked on the server.
- A punch the server refuses for good (outside every fence, or too old) stays on the phone with the reason,
  until it's dismissed. The person can then ask for a regularization on the web.

## Security

- The session lives in the device keychain (`expo-secure-store`), split into chunks because one keychain item
  holds about 2 KB (`src/lib/chunked-store.ts`).
- No secret keys in the app. `EXPO_PUBLIC_*` values are public by design.
- Bundle identifiers are `in.peoplecore.app` (ADR-012: separate from any other app).

## Builds and store release

EAS Build (`eas.json`). It needs an Expo account and Apple and Google developer accounts:

```sh
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile production --platform all && npx eas-cli submit --platform all
```

## Tests

`corepack pnpm --filter @peoplecore/mobile test` runs the offline queue and secure-storage logic in Node.
The screens are covered by typecheck and lint. Device testing needs a simulator or a phone.
