import { useEffect, useState } from 'react';
import { NO_SYNC_NOTICE, TERMS } from '@clarity/shared';
import { canPromptInstall, isStandalone, persistenceState, promptInstall, requestPersistence, type PersistState } from '../platform/persistence';
import { useData } from '../state/session';

const QA: [string, string][] = [
  [
    'What information is collected?',
    'Only what you enter or import: accounts, balances, transactions, categories, bills, income and settings. There is no sign-up, so we don’t have your name, email or bank details. Clarity has no analytics, tracking or advertising code.',
  ],
  [
    'Where is my financial information stored?',
    'In this browser’s storage (IndexedDB) on this device, and nowhere else. There is no Clarity server or cloud copy. Your other devices only receive data if you move it with an encrypted backup.',
  ],
  [
    'How are uploaded statements processed?',
    'The CSV file is read inside your browser by Clarity’s own code. It is never uploaded. The file itself isn’t kept: only the transactions you approve are saved (encrypted), including each row’s original description so you can trace where it came from.',
  ],
  [
    'Does any AI service see my financial information?',
    'No. Categories are suggested by fixed rules and by your own past choices, computed on this device. All numbers come from a deterministic calculation engine. No external AI service is used.',
  ],
  [
    'How is my information protected?',
    'Every record is encrypted with AES-256-GCM using a random key. That key is protected by your passphrase (Argon2id key derivation) and, optionally, a recovery key. The app locks after inactivity and clears decrypted data from memory. The page blocks connections to other servers with a Content Security Policy.',
  ],
  [
    'How do I export my data?',
    'Settings → Backup & export. An encrypted backup restores on any browser or on the Clarity mobile app. A CSV export is readable in spreadsheets but is not encrypted, so the app warns you first.',
  ],
  [
    'How do I permanently delete everything?',
    'Settings → Privacy & data → Delete all data. Clarity first destroys the encryption keys stored on this device and then deletes the database, so what remains cannot be decrypted by anyone. Backup files you saved elsewhere are not affected; delete them yourself.',
  ],
];

export function PrivacyCenter() {
  const data = useData();
  const [persist, setPersist] = useState<PersistState>('unsupported');
  useEffect(() => {
    void persistenceState().then(setPersist);
  }, []);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="t-title1">{TERMS.privacyCenter}</h1>
          <div className="sub muted t-callout">Plain answers about what happens to your information.</div>
        </div>
      </div>
      <div className="grid dash-mid">
        <div className="card">
          {QA.map(([q, a], i) => (
            <div key={q} className="kv" style={{ display: 'block', borderTop: i ? undefined : 0 }}>
              <h2 className="t-headline">{i + 1}. {q}</h2>
              <p className="t-callout muted" style={{ marginBottom: 0 }}>{a}</p>
            </div>
          ))}
        </div>
        <div className="stack" style={{ alignContent: 'start' }}>
          <div className="card">
            <h2 className="card-title">This device</h2>
            <div className="kv"><span>Storage protected from automatic clearing</span><span className={`badge ${persist === 'persisted' ? 'pos' : 'warn'}`}>{persist === 'persisted' ? 'Yes' : persist === 'not-persisted' ? 'Not granted' : 'Unknown'}</span></div>
            {persist !== 'persisted' && <button className="btn btn-secondary btn-sm" onClick={() => void requestPersistence().then(setPersist)}>Ask the browser again</button>}
            <div className="kv"><span>Installed as an app</span><span className="badge">{isStandalone() ? 'Yes' : 'No'}</span></div>
            {!isStandalone() && (
              <div className="callout" style={{ marginTop: 8 }}>
                Installing protects your data from automatic browser clean-up.{' '}
                {canPromptInstall() ? (
                  <button className="btn-link" onClick={() => void promptInstall()}>Install Clarity</button>
                ) : (
                  <>Safari on Mac: File → Add to Dock. Chrome or Edge: the install icon in the address bar.</>
                )}
              </div>
            )}
            <div className="kv"><span>Last encrypted backup</span><span className="t-footnote">{data.settings.lastBackupAt ? new Date(data.settings.lastBackupAt).toLocaleDateString() : 'Never'}</span></div>
          </div>
          <div className="card">
            <h2 className="card-title">Limits you should know</h2>
            <ul className="assumptions" style={{ marginTop: 0 }}>
              <li>{NO_SYNC_NOTICE}</li>
              <li>Browsers can clear website data, for example when storage is low or, in Safari, when a site that isn't installed hasn't been used for about a week. Installing Clarity and keeping backups protects you.</li>
              <li>If you forget your passphrase and lose your recovery key, no one can recover your data.</li>
              <li>While the app is unlocked, malicious browser extensions or software on your computer could read what is on screen. Lock the app when you step away.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
