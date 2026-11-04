// Unpacks and reads a save off the main thread: a gamestate has hundreds of MB, and the UI must stay responsive.
// The worker keeps the save for record lookups until it is closed.

import { buildSaveDigest, digestToText, saveReader } from '../../core/save/digest.ts';
import { SaveRecords } from '../../core/save/lookup.ts';
import { SaveData, unpackSave } from '../../core/save/save-file.ts';

let records: SaveRecords | undefined;

type Request = { id: number; op: 'open'; bytes: Uint8Array; localization: Map<string, string> } | { id: number; op: 'lookup'; name: string };

self.onmessage = ({ data }: MessageEvent<Request>) => {
  try {
    if (data.op === 'open') {
      self.postMessage({ id: data.id, step: 'Unpacking the save…' });
      const unpacked = unpackSave(data.bytes);
      self.postMessage({ id: data.id, step: 'Studying your house and realm…' });
      const save = new SaveData(unpacked);
      const localize = (key: string) => data.localization.get(key);
      const digest = buildSaveDigest(save, localize);
      records = new SaveRecords(save, saveReader(save, localize));
      self.postMessage({ id: data.id, result: { notes: digestToText(digest), date: digest.date, title: `${digest.ruler.name} of House ${digest.house.name}`, nickname: digest.ruler.nickname } });
    } else {
      self.postMessage({ id: data.id, result: records ? records.lookup(data.name) : 'The records are not open.' });
    }
  } catch (e) {
    self.postMessage({ id: data.id, error: (e as Error).message });
  }
};
