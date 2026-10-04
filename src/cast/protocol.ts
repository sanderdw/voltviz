/** What the VoltViz Cast sender and receiver say to each other over the custom Cast channel. */
export const CAST_NAMESPACE = 'urn:x-cast:com.voltviz.cast';

/**
 * Application ID of the VoltViz Custom Receiver (Google Cast SDK Developer Console), which points
 * at https://voltviz.com/cast-receiver.html. Not a secret. Forks that change the receiver register
 * their own and build with VITE_CAST_APP_ID.
 */
export const CAST_APP_ID: string = import.meta.env.VITE_CAST_APP_ID || '43CE6A0C';

/** WebRTC signaling: the sender offers a video-only stream, the receiver answers. Non-trickle ICE. */
export type CastMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'error'; message: string };

export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Resolves once ICE gathering is complete (or after `timeoutMs`), so the SDP carries the candidates. */
export function iceGatheringDone(pc: RTCPeerConnection, timeoutMs = 2000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      window.clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = window.setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

export function parseCastMessage(raw: unknown): CastMessage | null {
  let m: unknown = raw;
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch { return null; }
  }
  if (!m || typeof m !== 'object') return null;
  const { type, sdp, message } = m as Record<string, unknown>;
  if ((type === 'offer' || type === 'answer') && typeof sdp === 'string') return { type, sdp };
  if (type === 'error' && typeof message === 'string') return { type, message };
  return null;
}
