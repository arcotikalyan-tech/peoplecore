# PeopleCore mobile (Expo)

The employee app, built with Expo SDK 58 (React Native 0.88) and expo-router. Its five tabs:
- **Home**: a dashboard: check-in, what needs you, quick actions, leave, the month, who's out, payslip, holidays, birthdays, announcements.
- **Attendance**: today's punches, a month calendar, corrections, work from home and on duty.
- **Leave**: balances, apply, cancel, who's away.
- **Inbox**: approvals and notifications.
- **Me**: profile, payslips, directory, settings.

The design and the research behind it are in [docs/13-mobile-app.md](../../docs/13-mobile-app.md).

It talks to Supabase as the signed-in person with the **publishable key only**; row-level security decides what they see, exactly as on the web.

## Code layout

- `app/(app)/(tabs)/`: the five tabs. `app/(app)/*.tsx` holds the screens they open, with the stack's header and back button; forms are modals.
- `src/theme.tsx`: the website's design tokens (indigo light, coral dark), spacing, radii and the type scale. Light, dark or automatic, from Me › Appearance.
- `src/ui/`: the components. Screens import everything from `@/ui` and never use raw colors. Lint refuses react-native's `Text`.
- `src/lib/use-load.ts`: a screen's data: skeleton, then data or error, refreshed whenever the screen comes back into view.
- `src/lib/today.tsx`: today's check-in state, shared by Home and Attendance.
- `src/lib/counts.tsx`: the badge counts.

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
