// The open save of the Maester: a worker that holds it in memory. It closes itself after a while without use,
// which frees the memory, and opens again when a record is asked for.

import type { Platform } from '../platform/types.ts';

export interface SaveReading {
  notes: string;
  date: string;
  title: string;
  nickname?: string;
}

const IDLE_MS = 5 * 60 * 1000;

export class SaveArchive {
  private worker?: Worker;
  private file?: string;
  private next = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onStep?: (step: string) => void }>();
  private idle?: ReturnType<typeof setTimeout>;

  constructor(
    private platform: Platform,
    private localization: () => Promise<Map<string, string>>,
  ) {}

  close() {
    clearTimeout(this.idle);
    this.worker?.terminate();
    this.worker = undefined;
    this.file = undefined;
    for (const w of this.waiting.values()) w.reject(new Error('The save was closed.'));
    this.waiting.clear();
  }

  private ask<T>(message: object, transfer: Transferable[] = [], onStep?: (step: string) => void): Promise<T> {
    clearTimeout(this.idle);
    if (!this.worker) {
      this.worker = new Worker(new URL('./save-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<{ id: number; step?: string; result?: unknown; error?: string }>) => {
        const w = this.waiting.get(data.id);
        if (data.step) {
          w?.onStep?.(data.step);
          return;
        }
        this.waiting.delete(data.id);
        if (data.error) w?.reject(new Error(data.error));
        else w?.resolve(data.result);
        if (!this.waiting.size) this.idle = setTimeout(() => this.close(), IDLE_MS);
      };
      this.worker.onerror = (e) => {
        const error = new Error(e.message || 'Reading the save failed, perhaps for lack of memory.');
        for (const w of this.waiting.values()) w.reject(error);
        this.waiting.clear();
        this.close();
      };
    }
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, onStep });
      this.worker!.postMessage({ ...message, id }, transfer);
    });
  }

  /** Reads a save; returns the notes for the Maester. */
  async open(file: string, onStep?: (step: string) => void): Promise<SaveReading> {
    onStep?.(`Fetching ${file}…`);
    const bytes = await this.platform.saves.read(file);
    onStep?.("Gathering the game's texts…");
    const localization = await this.localization();
    const reading = await this.ask<SaveReading>({ op: 'open', bytes, localization }, [bytes.buffer], onStep);
    this.file = file;
    return reading;
  }

  /** What the save knows about a name; opens the save again if it was closed. */
  async lookup(file: string, name: string): Promise<string> {
    if (this.file !== file) {
      try {
        await this.open(file);
      } catch (e) {
        return `The save ${file} cannot be read any more (${(e as Error).message}).`;
      }
    }
    return this.ask<string>({ op: 'lookup', name });
  }
}
