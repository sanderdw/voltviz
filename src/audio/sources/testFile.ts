/**
 * Development/test-only audio source: `?testAudio=<url>[&testAudioStart=<seconds>]` plays a
 * file through an <audio> element (dev builds only; used by the evaluation harness and the
 * Chrome checks). Serve local excerpts via the dev-server route /__testaudio/<file>.
 */
export interface TestAudio {
  element: HTMLAudioElement;
  /**
   * The element's output as a MediaStream (captureStream). The engine taps this stream, like
   * any other source; an element can only ever be bound to one MediaElementSourceNode, which
   * does not survive engine re-creation (e.g. React StrictMode).
   */
  stream: MediaStream;
  stop(): void;
}

export function testAudioParams(): { url: string; start: number } | null {
  if (!import.meta.env.DEV) return null;
  const p = new URLSearchParams(window.location.search);
  const url = p.get('testAudio');
  if (!url) return null;
  return { url, start: parseFloat(p.get('testAudioStart') ?? '0') || 0 };
}

export async function startTestAudio(url: string, start: number): Promise<TestAudio> {
  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  el.src = url;
  await new Promise<void>((resolve, reject) => {
    el.addEventListener('loadedmetadata', () => resolve(), { once: true });
    el.addEventListener('error', () => reject(new Error(`test audio failed to load: ${url}`)), { once: true });
  });
  el.currentTime = start;
  await el.play();
  const capture = (el as HTMLMediaElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream });
  const stream = capture.captureStream ? capture.captureStream() : capture.mozCaptureStream!();
  return {
    element: el,
    stream,
    stop() {
      el.pause();
      el.removeAttribute('src');
      el.load();
    },
  };
}
