# Device test script

Nothing below could be tested in the development container: it has no iPhone or Android simulator, and no Safari or Edge. A platform is **not** considered supported until this script passes on it. Record results in the table at the end. Use a test passphrase and fictional numbers.

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
