# Phone app: research and design (2026-10-31)

On 2026-10-31 the owner judged the phone app unprofessional. They said it had "no proper dashboard, no proper settings" and poor headings and navigation. This document covers:
- what the leading HRMS apps do;
- the design guidance that applies;
- how the redesigned app is laid out;
- what comes next.

The research was done from store listings, vendor help centres, release notes, review sites and the Material 3, Apple HIG, Android settings and NN/g guidance. Sources are linked inline. Store screenshots are marketing renders and can lag the live app.

## What the market does

### Indian HRMS apps

| App | Bottom navigation | Home, top to bottom |
|---|---|---|
| Keka ([help](https://help.keka.com/hc/en-us/articles/39946833086481)) | Home, Me, Inbox, Engage (+ team) | Quick access that adapts to use (apply leave, WFH, payslip, ticket, expense); shift and clock-in; on leave this week; "Wish them" (birthdays, anniversaries, joiners); announcements; holidays |
| greytHR ([help](https://www.greythr.com/help-ess-mobile/get-started-ess-mobile-app/greythr-mobile-app-homepage)) | Home, Action, Explore | Greeting; sign in/out with a live timer; exception days with Regularize; payslip; IT declaration; holidays; review and who's in (managers); feed |
| Zoho People ([guide](https://help.zoho.com/portal/en/kb/people/mobile/mobile-app-guide/articles/zoho-people-mobile-application-help-guide)) | Home, Attendance, (+), Leave, More | My space / Team / Organization; check-in timer; an "absent: apply leave" nudge; schedule |
| Darwinbox | Home, Tasks, (+), Apps, My Hub | Banner; clock-in; tasks awaiting you; recommendations |
| PeopleStrong | Today, Tasks, AI, Workgroups, All modules | Greeting with punch times; favourites; celebrations |
| Pocket HRMS ([docs](https://docs.pockethrms.com/pocket-hrms-2.0-mobile-app/dashboard)) | four icon tabs | Punch; holiday; my team; events; leave summary; finance; company buzz |

### Global HRMS apps

| App | Bottom navigation | Home and other notes |
|---|---|---|
| Workday ([KB](https://service.louisville.edu/TDClient/277/Portal/KB/Article/20712/Using-Workday-Mobile)) | Home, Inbox, Notifications, Apps | "Awaiting your action" top 3; check-in card; manager "Team attendance" card |
| SAP SuccessFactors | Home, To Do, Search, Team (managers), Browse | One "Profile and Settings" screen |
| Personio | Home, calendar, Inbox, People, profile | Time off card, who's out today, time tracking (hidden when not used) |
| BambooHR | Home, My Info, People, More | For You feed, My Time, balances |
| Factorial ([help](https://help.factorialhr.com/en_US/managing-my-employee-profile/about-the-factorial-dashboard)) | menu in the last tab | Clock-in, inbox, holidays & events, birthdays, team status for managers |

### What reads as professional

**Consensus across these apps:**
1. Five labelled tabs.
2. Home comes first.
3. One tab is a work queue (Inbox, Tasks or To Do).
4. Profile and settings live together under Me.

**Home order:**
1. Today's check-in with a live timer.
2. What needs you, with a one-tap fix.
3. Quick actions.
4. Leave balance.
5. Team: who's out.
6. Payslip.
7. Holidays.
8. Celebrations.
9. Announcements.

**Touches users notice:**
- Salary hidden until tapped: Keka's mask, Zoho's biometric lock.
- Teammates already away shown on the leave form (Keka).
- Exceptions on Home that fix in one tap: greytHR's gap days, Zoho's absent nudge.
- Reject asks for a reason (greytHR).
- Offline punch with later sync.
- Dark mode.
- Indian languages.

**Common complaints in reviews:**
- Punches failing at the office, and wrong geofences.
- Slow launches.
- Forced sign-outs.
- Late notifications.
- No confirmation before clocking out (Kredily: people clock out by accident).
- Too little on the phone compared with the web.

### Design rules applied

**Navigation:**
- Three to five destinations, always labelled, never disabled; explain empty ones with an empty state. ([M3 navigation bar](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md), [HIG tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars))
- A badge only for what needs action. ([HIG](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [NN/g indicators](https://www.nngroup.com/articles/indicators-validations-notifications/))
- Large titles on top-level screens; the standard back button on screens opened from them. ([HIG toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars))

**Loading and errors:**
- Skeletons on first load, never a blank screen. ([NN/g](https://www.nngroup.com/articles/skeleton-screens/), [HIG loading](https://developer.apple.com/design/human-interface-guidelines/loading))
- A designed empty state for every list. ([NN/g](https://www.nngroup.com/articles/empty-state-interface-design/))
- Errors near their source, in plain words, with Retry. ([NN/g](https://www.nngroup.com/articles/error-message-guidelines/))

**Interaction:**
- Touch targets of at least 48 dp; a 4-point grid with 16 dp margins. ([Android accessibility](https://developer.android.com/guide/topics/ui/accessibility/apps))
- Sheets for quick tasks; destructive actions styled as such and confirmed. ([HIG sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [HIG action sheets](https://developer.apple.com/design/human-interface-guidelines/action-sheets))

**Settings:**
- Settings grouped, most used first.
- The current value shown on the row.
- Account, help and about as their own screens.

([Android settings](https://developer.android.com/design/ui/mobile/guides/patterns/settings))

## How the app is laid out

### Tabs

The five tabs are **Home · Attendance · Leave · Inbox · Me**.
- Attendance and Leave are hidden when the organization switched those modules off.
- The Inbox badge counts only approvals waiting for you. Unread notifications show on Home's bell.

### Home

Top to bottom:
1. Greeting with the date and organization; the bell, with unread count; your avatar.
2. The organization setup card, for the owner and HR until setup is done.
3. **Today**: shift, check-in and check-out times, worked time against a full day, one Check in / Check out button. Checking out asks first.
4. **Needs your attention**:
   - the top 3 approvals;
   - days to correct this month (an absence, or a check-in with no check-out);
   - announcements to acknowledge;
   - profile completeness.
5. **Quick actions** (4 across):
   - Apply leave
   - Correct a day
   - Work from home
   - Payslips
   - Holidays
   - Directory
   - News
   - My profile
6. Leave balance, scrolling sideways.
7. The month's totals: present, late, on leave, absent.
8. Who's out today.
9. Latest payslip, with net pay hidden until Show.
10. Upcoming holidays.
11. Celebrations.
12. Announcements.

Each section appears only when it has something in it, and only for modules in use.

### The other tabs

- **Attendance**:
  - Today's card.
  - A month calendar tinted by status, with a legend; status is also spoken, never color alone.
  - Tap a day for its times, and "Correct this day" for past days.
  - The month's totals.
  - Your requests: corrections, WFH, on duty.
- **Leave**:
  - An Apply button.
  - Balance cards: available and pending.
  - Upcoming and History; tap an upcoming leave to cancel it, with a confirmation.
  - Who's away in the next two weeks.
  - The holiday calendar.
- **Inbox**:
  - Approvals and Notifications, each with its count.
  - Approve at once, or Reject with a required reason in a sheet.
  - Tapping a notification marks it read and opens its screen.
- **Me**:
  - A profile card.
  - My work: payslips, attendance requests, holidays, directory, announcements.
  - Switch organization.
  - Settings: sign-in & security, notifications, appearance.
  - Help: the website, About.
  - Sign out, confirmed.

### Screens opened from the tabs

- Apply for leave (a modal):
  - type chips with what's left of each;
  - dates;
  - half days where the type allows them;
  - reason;
  - teammates already away on those dates.
- Attendance request (a modal).
- Payslips: the financial year's totals, months grouped by financial year, amounts hidden until Show.
- Payslip: net pay, earnings, deductions, the PDF.
- Holidays: the year by month, optional ones marked.
- Directory: search, then call or email.
- Announcements: with acknowledge.
- My profile:
  - work details;
  - contact;
  - the profile checklist, with edits made on the website.
- Your organizations.
- Sign-in & security.
- Change password.
- Two-step sign-in.
- Notifications.
- Appearance: Automatic / Light / Dark.
- About.

### Design system

**Code:**
- `src/theme.tsx`: the website's tokens (indigo light, coral dark), a 4-point spacing scale, radii and a type scale. Light, dark or automatic, remembered on the phone.
- `src/ui/`: the components.
  - Text in the scale.
  - Buttons (primary, tonal, outline, ghost, danger; 36/48/52 pt).
  - Icon buttons with counts.
  - Cards and section headers.
  - Grouped list rows: icon tile, title, subtitle, value, chevron or control.
  - Avatars with initials.
  - Status pills.
  - Banners, empty and error states.
  - Skeletons and the logo loader.
  - Segmented control, chips.
  - Fields with focus and error states.
  - Bottom sheets, toasts.

**Data:**
- `src/lib/use-load.ts`: skeleton → data or error, refreshed quietly whenever a screen comes back into view.
- `src/lib/today.tsx`: the check-in state Home and Attendance share.
- `src/lib/counts.tsx`: the badge counts.

## What comes next

| Priority | Feature | Notes |
|---|---|---|
| P1 | Expenses: claim from a receipt photo, track status | RPCs exist (`create_expense_claim`, `add_expense_item`, `submit_expense_claim`) |
| P1 | Team view for managers: who's in, late, not checked in; team leave calendar | `attendance_week_counts`, `team_leave_calendar` |
| P1 | Profile photos (signed links through the app server) | Avatars use initials until then |
| P2 | Helpdesk: raise and follow tickets | `raise_ticket`, `ticket_thread`, `comment_ticket` |
| P2 | Documents and letters: download your letters, request one | `request_letter`, `document_download` |
| P2 | Tax declarations and Form 16 | `save_tax_declaration` |
| P2 | App lock with the phone's biometrics; hide pay by default | — |
| P3 | Kudos and celebrations ("Wish"), assets, policies to acknowledge, optional-holiday choice | `give_kudos`, `acknowledge_policy`, `choose_optional_holiday` |
| P3 | Indian languages | — |
