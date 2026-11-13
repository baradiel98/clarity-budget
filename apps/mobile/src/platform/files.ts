import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface PickedFile {
  name: string;
  size: number;
  text: string;
}

/** Pick a file, read it, then delete the app's cached copy. Nothing leaves the device. */
export async function pickTextFile(types: string[]): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  const f = new File(a.uri);
  try {
    const size = a.size ?? f.size ?? 0;
    if (size > 50 * 1024 * 1024) throw new Error('This file is too large.');
    return { name: a.name, size, text: await f.text() };
  } finally {
    try {
      if (f.exists) f.delete();
    } catch {
      /* cached copy cleanup is best-effort */
    }
  }
}

/** Write to the cache, open the system share sheet (Save to Files / Drive), then delete the temp file. */
export async function shareTextFile(fileName: string, text: string, mimeType: string, uti?: string): Promise<void> {
  const f = new File(Paths.cache, fileName);
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  try {
    await Sharing.shareAsync(f.uri, { mimeType, dialogTitle: fileName, ...(uti ? { UTI: uti } : {}) });
  } finally {
    try {
      f.delete();
    } catch {
      /* best-effort */
    }
  }
}

export const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
