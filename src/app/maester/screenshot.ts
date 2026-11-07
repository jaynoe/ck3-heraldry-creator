// Screenshots for the Maester: scaled down in the page, so they are small enough to send and to keep in the chat.
// An <img> rather than createImageBitmap, which older WebKitGTK versions lack.

import type { RequestImage } from '../../core/ai/provider.ts';

const SEND_SIZE = 1568; // beyond this the Claude API scales images down anyway

export interface Screenshot {
  image: RequestImage;
  /** The same image as a data URL, kept in the chat and shown in the lightbox. */
  url: string;
}

function scaled(img: HTMLImageElement, longest: number, quality: number): string {
  const factor = Math.min(1, longest / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * factor);
  canvas.height = Math.round(img.naturalHeight * factor);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function readScreenshot(file: Blob): Promise<Screenshot> {
  if (!file.type.startsWith('image/')) throw new Error('This file is not an image.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('This image could not be read.');
    });
    const data = scaled(img, SEND_SIZE, 0.85);
    return { image: { mediaType: 'image/jpeg', base64: data.split(',')[1]! }, url: data };
  } finally {
    URL.revokeObjectURL(url);
  }
}
