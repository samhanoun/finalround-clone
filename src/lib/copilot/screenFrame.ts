/**
 * One frame of the shared tab or screen as a JPEG, for "Solve screen"
 * (build plan Step 9). Uses the display video track the audio capture already
 * holds, so there's no second share prompt.
 */

export type ScreenFrame = { jpegBase64: string; width: number; height: number; bytes: number };

/** Wide enough to read code in a shared editor, small enough to upload in a moment. */
export const SCREEN_FRAME_MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.82;

/** Scales (width, height) down to fit maxWidth, keeping the aspect ratio. Never scales up. */
export function fitWithin(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

type ImageCaptureLike = { grabFrame(): Promise<ImageBitmap> };
type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

async function drawableFrom(track: MediaStreamTrack): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  // TypeScript's DOM types leave out grabFrame(), so the constructor is typed here.
  const ImageCaptureCtor = (globalThis as unknown as { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  if (ImageCaptureCtor) {
    const bitmap = await new ImageCaptureCtor(track).grabFrame();
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }

  // Firefox and Safari have no ImageCapture: play the track in a detached video element.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  await video.play();
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }));
  }
  return {
    source: video,
    width: video.videoWidth,
    height: video.videoHeight,
    release: () => {
      video.pause();
      video.srcObject = null;
    },
  };
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function grabScreenFrame(track: MediaStreamTrack, maxWidth = SCREEN_FRAME_MAX_WIDTH): Promise<ScreenFrame> {
  if (track.readyState !== 'live') throw new Error('Screen sharing has stopped.');

  const frame = await drawableFrom(track);
  try {
    if (!frame.width || !frame.height) throw new Error('The shared screen has no picture yet.');
    const size = fitWithin(frame.width, frame.height, maxWidth);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not read the shared screen.');
    context.drawImage(frame.source, 0, 0, size.width, size.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Could not read the shared screen.');
    return { jpegBase64: toBase64(await blob.arrayBuffer()), width: size.width, height: size.height, bytes: blob.size };
  } finally {
    frame.release();
  }
}
