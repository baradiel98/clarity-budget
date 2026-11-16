# Device test script

Nothing below could be tested in the development container: it has no iPhone or Android simulator, and no Safari or Edge. A platform is **not** considered supported until this script passes on it. Record results in the table at the end. Use a test passphrase and fictional numbers.

## QA status at a glance (updated 2026-11-15)
Only what is listed as done has evidence. Everything else has **not been performed**. Browser automation is not device testing.

| Kind of testing | Status | Evidence / where |
|---|---|---|
| Browser automation (Chromium, Playwright) | **Done**: web app, desktop and phone widths | `apps/web/e2e/*.spec.ts`, including `phase5a.spec.ts` and `phase5a1.spec.ts` |
| Component tests of the mobile app (Node, Jest) | **Done**: logic and screens in a test renderer | `apps/mobile/test/*.test.tsx` |
| Mobile app rendered through React Native for Web in Chromium | **Done, Phase 4B.5 only**: a layout approximation | `docs/implementation-report.md` §7af |
| Real iPhone (native app) | **NOT PERFORMED** | §1, §2, §2b, §2c |
| Real Android phone (native app) | **NOT PERFORMED** | §1, §2, §2b, §2c |
| Safari (macOS and iOS) | **NOT PERFORMED** for any listed step | §2c "Safari", §3 D3. The owner only confirmed the hosted web app loads on iPhone Safari (Results table) |
| VoiceOver (iPhone) | **NOT PERFORMED** | §2 M10, §2b M23, §2c A1–A3 |
| TalkBack (Android) | **NOT PERFORMED** | §2 M10, §2b M23, §2c A1–A3 |

**How to record a result:** write PASS or FAIL in the Status column (or the Results table), with the device, OS version, date and tester. For a FAIL, note what you saw. Never mark a step PASS from a browser test.

## Which version am I running? (hosted web app)
The web app works offline, so a phone or browser can keep showing the version it saved earlier. After a deploy:
1. Open **Settings → Privacy & data → App version**. It shows `Version` plus the first 7 characters of the deployed git commit.
2. Compare it with the latest commit on the deployed branch (`phase-1`) on GitHub, or with the commit shown in Render's deploy log.
3. If it is older, tap **Check for updates**. When the new version has downloaded, a "A new version of Clarity is ready" banner appears; tap **Reload**. (Closing the tab completely and reopening also works.)

## Remember this device (iPhone Safari and desktop)
1. Lock Clarity. On the unlock screen, check **Remember this device**, choose 7 or 30 days, and enter the passphrase.
2. Refresh, close the tab and reopen the link: Clarity opens without the passphrase.
3. **Settings → Security → This device** shows the date until which it is remembered.
4. Tap **Lock**: the passphrase is asked again (also after a refresh). Unlock once and remembered access continues.
5. **Forget this device**, then refresh: the passphrase is asked.
6. Note whether Safari keeps the remembered state after several days without opening Clarity (Safari may clear data for sites that are not added to the Home Screen).

## 0. Run the apps
**Web (desktop):**

```bash
npm install
```

```bash
npm run build -w @clarity/web
```

```bash
npm run preview -w @clarity/web
```

Then open http://localhost:4173 in Chrome, Edge and Safari (macOS).

**Mobile, quick start (Expo Go app from the App Store / Play Store):**

```bash
cd apps/mobile && npx expo start
```

Scan the QR code. Expo Go covers everything except Face ID on iPhone.

**Mobile, development build (needed for Face ID; recommended before release):**

```bash
cd apps/mobile && npx expo run:ios
```

This needs a Mac with Xcode. Alternatively, `eas build --profile development` needs a free Expo account.

## 1. Every platform
| # | Step | Expected |
|---|---|---|
| 1 | Settings → Self-test (web: `/dev/self-test`) | "All checks passed". **Write down the Argon2id time.** Over ~3 s on a phone means a native Argon2 module should be considered (see docs/security.md) |
| 2 | Welcome → Get started; passphrase `river otter lantern`; keep the recovery key on | Recovery key shown; Continue enabled only after typing its last group |
| 3 | Balance 1200 → paid every 2 weeks, next payday 9 days from today, $1,800 → bill "Rent" $1,400, 10 days from today, monthly | Overview shows a projected month-end equal to your hand calculation |
| 4 | Add a $6.50 expense "Coffee" | Saves in ≤ 5 taps/keys; Undo toast; Safe to Spend drops by $6.50 |
| 5 | Add the same again | Duplicate warning; second Save adds it |
| 6 | "Can I afford this?" with an amount larger than Safe to Spend | "Tight" or "No" with the shortfall; nothing saved |
| 7 | Planning → Rent → Skip this one | Month-end projection changes by $1,400 |
| 8 | Import Statement → `packages/import/test/fixtures/signed-newest-first.csv` | Asks for the date format (it's ambiguous); 7 rows; import works; Undo works |
| 9 | Settings → Backup → save the encrypted backup | File saved; contains no readable merchant names |
| 10 | Delete all data → restore that backup with the passphrase | Same numbers as before |
| 11 | Light / dark mode (system setting) | Every screen readable; no low-contrast text |
| 12 | Turn off the network (airplane mode / devtools offline), reload or relaunch | App works fully |

## 2. iPhone and Android only
| # | Step | Expected |
|---|---|---|
| M1 | Settings → Security → turn on Face ID / fingerprint | System prompt; toggle stays on |
| M2 | Leave the app for more than 1 minute (auto-lock 1 min), return | Lock screen; biometric prompt appears; unlocks |
| M3 | Cancel the biometric prompt | Passphrase field still works |
| M4 | Change enrolled fingerprints / Face ID in system settings, reopen | "unlock is no longer available" message; passphrase works; can turn it on again |
| M5 | Open the app switcher | App content hidden behind the logo |
| M6 | Android: take a screenshot | Blocked (black or refused) |
| M7 | Increase system text size to the maximum | Text scales; no overlapping or clipped amounts on Home and Add |
| M8 | Small phone (iPhone SE / 5-inch Android) and large phone | Tab bar, Add sheet and keypad fully visible; Save reachable with one hand |
| M9 | Rotate the phone | Stays in portrait (by design in Phase 1) |
| M10 | VoiceOver / TalkBack on Home | Amounts are read as "minus …"/"plus …"; buttons are labelled |
| M11 | Restore a backup made on the **web** app; make a backup on the phone and restore it on the **web** | Identical numbers both ways |
| M12 | Import a CSV from Files / Drive / Downloads | Picker opens; review screen works |

## 2b. Phase 4B.5: Phase 4B journeys on iPhone and Android (NOT RUN on any device)
Phase 4B.5 checked these only in the mobile app rendered through React Native for Web (Chromium at 360×640, 375×667, 390×844 and 393×851) and in component tests. Native keyboards, safe areas, modals, haptics, storage and screen readers were not available there.

Start with **Sample data** for M13–M20 (nothing is saved). Use a new test workspace for M21. Never use real data for these steps.

Status of every step M13–M25: **NOT RUN** on iPhone, Android, VoiceOver or TalkBack. Phase 4B.5 stays incomplete (no `phase4b5-complete` tag) until these are run.

| # | Step | Expected |
|---|---|---|
| M13 | Home on a small (iPhone SE / 360dp Android) and a large phone | Order: recorded balance, Safe to Spend, projected month-end. No clipped amounts; nothing hidden behind the tab bar or home indicator |
| M14 | Home → Why this number? on each figure; close with Done | Explanation scrolls to the end; Done returns to Home |
| M15 | Change the phone date ~8 weeks ahead (or wait for bills to pass), reopen | Home shows one "Past due" line ("N items since … need a decision"); Upcoming lists only future items; Review opens Planning |
| M16 | Planning → Catch up: Mark paid on one item, choose an existing payment if offered, Save; Skip another; Undo the skip | Only those occurrences leave the list; the next month's occurrence stays; Undo restores the skipped one; no new transaction is created by linking |
| M17 | Mark paid → "Notes or pending" → tick Pending → Save | The Notes field and Pending checkbox scroll into view above the keypad; Paid this month shows the item as Pending |
| M18 | Type in the Notes field and in Merchant | The system keyboard does not cover the field being typed in or the Save button; tapping outside dismisses it |
| M19 | Planning → Paid this month: expand, collapse; tap a row | Expands and collapses; the row opens Edit transaction with "Records the scheduled payment …" and Unlink |
| M20 | Capture: type three purchases, Prepare | Three drafts; one "No account was mentioned in these 3 drafts" note; keyboard dismisses; drafts scroll; nothing saved until Approve |
| M21 | New workspace: Get started → passphrase → recovery key → balance (open "More about this balance") → payday → Skip bill → first overview | Each step fits the screen with the keyboard open; Skip works; the overview shows the entered numbers |
| M22 | Transactions on a 360dp-wide phone | "This month · Last month · 90 days · All" all readable (none cut short) |
| M23 | VoiceOver / TalkBack: Home past-due line, Catch up buttons, Paid this month header | Reads "Past due… Review in Planning"; "Mark paid: Rent, due Jan 1"; the header announces collapsed/expanded |
| M24 | Largest system text size: Home, Catch up, Add | Text scales (capped); buttons stay tappable; no overlapping text |
| M25 | Welcome screen on a 375–390pt phone | "Restore backup" may wrap onto two lines inside its button (seen in the web rendering); note whether it does on the device |

## 2c. Phase 5A: daily balance ledger on iPhone and Android (NOT RUN on any device)
This is separate from Phase 4B.5 (§2b). None of these steps has been run on a real iPhone, a real Android phone, a simulator, Safari, VoiceOver or TalkBack. The Chromium and Node tests listed at the top cover the calculations and the web layout only.

**Before you start**
- **Sample data:** on the first screen, tap **Sample data** (mobile) or **Explore sample data** (web). Nothing is saved, and a "Sample data" banner shows. Sample data is made fresh from the phone's own date, so dates and some figures differ from day to day. The steps below say what to compare rather than fixed figures.
- **Test workspace:** for P5 and P6 you need a test workspace with fictional numbers (Get started, any test passphrase). Delete it afterwards in Settings.
- **Where:** in the Planning tab, the schedule card has a **Show** button (mobile: a rounded chip under the card title; web: a "Show" drop-down). Each day in the schedule has a **Day details** link on the right of its date row.
- **Adding a purchase:** the Add button (mobile: the round + in the tab bar; web: Add Transaction).

| # | Steps | Expected | Status |
|---|---|---|---|
| P1 | Sample data → Planning → tap **Show** → pick **Everyday Checking**. Repeat for **Savings**, **Visa Card** and **All spendable cash** | A list appears with All spendable cash, Everyday Checking, Savings, Visa Card and Cancel. After each choice the chip shows that name and the schedule changes (its amounts are that account's) | NOT RUN |
| P2 | Show → Everyday Checking. Find the first day that lists **Electricity**; tap its **Day details** | A screen titled "<that date> · Everyday Checking". The first line is "Start of day", then Electricity with "≈" (estimated) and its amount, with a smaller figure under the amount (the balance after it), then "End of day". Start of day minus the Electricity amount equals the figure under it and the End of day, and the End of day equals the amount shown for that day in the schedule. **Done** returns to Planning | NOT RUN |
| P3 | Show → Visa Card | Each day's amount reads "Owed $…". A note above the schedule says interest and fees you haven't recorded aren't included | NOT RUN |
| P4 | Show → Everyday Checking. Open today's Day details and write down "Recorded balance today". Close. Add an $85.00 purchase, account Everyday Checking, today's date. Open today's Day details again | The purchase appears once, marked "Recorded", and the figure under it is the noted amount minus $85.00. The End of day is $85.00 lower than before | NOT RUN |
| P5 | Test workspace with **one** checking account (fictional figures). Settings → **Accounts** → tap the account → **Update balance** (web: Settings → Accounts → the scale icon beside it), enter its current balance, save. Wait a few seconds, then add a $10.00 purchase on that account dated today. Planning → today's **Day details** (with only one account there is no Show chip or drop-down: the schedule is already that account's own view, and the Day details link names the account) | The schedule shows no Show control. The first line is "Confirmed balance (<today>)" with the amount you entered; the purchase line says "recorded after you confirmed the balance", and the figure under it is $10.00 lower. (If the purchase was recorded in the same instant as the confirmation, it may instead say "recorded at the same moment as the confirmation…", which is correct behaviour) | NOT RUN |
| P6 | In the P5 workspace: Settings → **Backup & export** → **Save encrypted backup** (sample data can't be backed up). On a computer, open the web app in a fresh browser profile, choose **Restore backup** on the first screen with that file and the passphrase. Open the same Day details. Then the reverse (web backup → phone) | Same lines and same amounts on both | NOT RUN |
| P7 | On the smallest phone available (iPhone SE / a 360dp-wide Android) with the largest system text size: Planning schedule with Show → Savings after P8, then a Day details screen | Date, amount and "Day details" on each day row are fully readable and don't overlap. The highlighted badge wraps rather than being cut off. "Day details" is easy to tap (at least about a fingertip, 44pt / 48dp) | NOT RUN |
| P8 | Sample data → Planning → Show → Savings; note the Savings amount on today's row (S). Add a purchase from **Savings** of S + $800.00 (for example $6,000.00 when S is $5,200.00), dated one week from today. Show → Savings again | (a) On that day the amount is −$800.00. (b) The purchase row has a highlighted badge "$800.00 shortfall · counted against spendable accounts". (c) A note above the schedule says the balances assume the full payment is taken from Savings, the shortfall is counted against your spendable accounts (Clarity hasn't chosen which), and what your bank would do can't be known. (d) That day's Day details says Savings can cover S of the payment, the other $800.00 is a shortfall, and your bank's actual response can't be known. (e) Show → All spendable cash: that day is $800.00 lower than before the purchase; Show → Everyday Checking: the purchase isn't listed | NOT RUN |

### Accessibility (VoiceOver on iPhone, TalkBack on Android): NOT RUN
Turn on VoiceOver (Settings → Accessibility → VoiceOver) or TalkBack (Settings → Accessibility → TalkBack). Swipe right to move to the next item; double-tap to activate. Write down exactly what is read.

| # | Steps | Expected | Status |
|---|---|---|---|
| A1 | Sample data → Planning → Show → Everyday Checking; swipe to a day's "Day details" | It reads "Day details: <weekday, month day>, Everyday Checking" (the date and the account), and double-tap opens it | NOT RUN |
| A2 | In Day details, swipe through each line | Each line reads its label, amount and the balance after it. Known risk: on mobile each line is one element, so the words "Balance after" may not be read, only the figure. Record what is read | NOT RUN |
| A3 | Swipe to the Show chip | It reads "Show: <account name>. Change" and double-tap opens the account list | NOT RUN |
| A4 | After P8, swipe to the Savings purchase row and its badge | The badge text ("$800.00 shortfall · counted against spendable accounts") is read | NOT RUN |

### Safari (macOS and iOS), web app: NOT RUN
| # | Steps | Expected | Status |
|---|---|---|---|
| S1 | Web app in Safari → Explore sample data → Planning → Show drop-down: pick each account | Same as P1 | NOT RUN |
| S2 | Day details on any day; close with the × or Esc (Mac) | The panel opens from the right (Mac) or fills the screen (iPhone); lines scroll; it closes | NOT RUN |
| S3 | P8 on the web app | Same as P8 | NOT RUN |

## 3. Desktop web only
| # | Step | Expected |
|---|---|---|
| D1 | Keyboard only: `N` add, `/` search, `↑↓` rows, `E` edit, `Delete`, `?` help, `Esc` | All work; focus is always visible |
| D2 | Window widths 1280, 1440, 1920 and a narrow window | Layout adapts, with no overlap |
| D3 | Safari: Privacy Center → storage persistence | Note the status; install with File → Add to Dock |
| D4 | Edge / Chrome: Privacy Center → Install Clarity | Installs as an app |

## Results
| Platform / version | Device | Self-test (Argon2 ms) | Section 1 | Section 2/3 | Tester / date | Notes |
|---|---|---|---|---|---|---|
| iOS (Safari) | iPhone 18 Pro Max | | | | owner, 2026-11-13 | Web app loads after allow-listing the site in AdGuard (content blocker blocked scripts). Native app not yet tested |
| Android | | | | | | |
| Safari macOS | | | | | | |
| Chrome | ✅ automated (Playwright, Chromium 1243) | ✅ | ✅ (automated equivalents) | D1 partial (automated) | dev container, 2026-11-13 | |
| Edge | | | | | | |
