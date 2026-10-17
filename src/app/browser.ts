// Browser helpers shared by all platforms (the Tauri webview is a browser too).

import type { RgbaImage } from '../core/dds/dds.ts';

export function toImageData(img: RgbaImage): ImageData {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

export async function encodePngBrowser(img: RgbaImage): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d')!.putImageData(toImageData(img), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function copyText(text: string): Promise<void> {
  // writeText can wait forever (e.g. when the window has no focus); fail visibly instead.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the clipboard did not respond – click into the window and try again')), 5000);
  });
  try {
    await Promise.race([navigator.clipboard.writeText(text), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
