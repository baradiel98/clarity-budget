import { NO_SYNC_NOTICE, TERMS } from '@clarity/shared';
import { useSession } from '../../src/state/session';
import { Card } from '../../src/ui/Card';
import { SubScreen } from '../../src/ui/SubScreen';
import { T } from '../../src/ui/Text';

export default function Privacy() {
  const s = useSession();
  const qa: [string, string][] = [
    ['What information is collected?', 'Only what you enter or import: accounts, balances, transactions, categories, bills, income and settings. There is no sign-up, so we don’t have your name, email or bank details. The app contains no analytics, tracking or advertising code.'],
    ['Where is my financial information stored?', 'In an encrypted database inside this app’s private storage on this phone, and nowhere else. There is no Clarity server or cloud copy. Android system backups of the app are turned off.'],
    ['How are uploaded statements processed?', 'The file you pick is read by the app on this phone. It is never uploaded. The app’s temporary copy is deleted right after reading, and only the transactions you approve are saved, encrypted.'],
    ['Does any AI service see my financial information?', 'No. Category suggestions come from fixed rules and your own past choices, computed on this phone. All numbers come from a deterministic calculation engine.'],
    ['How is my information protected?', `Every record is encrypted with AES-256-GCM using a random key. That key is protected by your passphrase (Argon2id) and, optionally, a recovery key.${s.biometric.enabled ? ` A copy is held in the phone’s secure hardware and released only after ${s.biometric.label}.` : ''} The app locks when you leave it and hides its content in the app switcher. On Android, screenshots of the app are blocked.`],
    ['How do I export my data?', 'Settings → Backup & export. An encrypted backup restores on any phone or the web app. CSV export is readable in spreadsheets but is not encrypted, so the app warns you first.'],
    ['How do I permanently delete everything?', 'Settings → Delete all data. The app first destroys the encryption keys on this phone (including the biometric copy) and then deletes the database, so what remains cannot be decrypted. Backup files you saved elsewhere are not affected.'],
  ];
  return (
    <SubScreen title={TERMS.privacyCenter}>
      {qa.map(([q, a], i) => (
        <Card key={q}>
          <T variant="headline">{i + 1}. {q}</T>
          <T color="textSecondary" style={{ marginTop: 6 }}>{a}</T>
        </Card>
      ))}
      <Card title="Limits you should know">
        <T color="textSecondary">• {NO_SYNC_NOTICE}</T>
        <T color="textSecondary">• If you forget your passphrase and lose your recovery key, no one can recover your data.</T>
        <T color="textSecondary">• Deleting the app deletes its data. Keep an encrypted backup.</T>
      </Card>
    </SubScreen>
  );
}
