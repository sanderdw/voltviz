/**
 * The WebRTC side of one Cast session: offers the compositor's video track (no audio) to the
 * VoltViz receiver over the custom Cast channel and reports the connection state. A failed
 * connection is renegotiated a few times before it gives up.
 */
import { CAST_NAMESPACE, ICE_SERVERS, iceGatheringDone, parseCastMessage } from './protocol';

export type StreamState = 'connecting' | 'connected' | 'failed';

const MAX_BITRATE = 6_000_000;
const MAX_ATTEMPTS = 3;

/** H.264 first (hardware-decoded on every Chromecast), then VP8, then whatever else is offered. */
function preferredCodecs(): RTCRtpCodec[] | null {
  const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs;
  if (!codecs?.length) return null;
  const rank = (c: RTCRtpCodec) => (c.mimeType === 'video/H264' ? 0 : c.mimeType === 'video/VP8' ? 1 : 2);
  return [...codecs].sort((a, b) => rank(a) - rank(b));
}

export class CastStreamer {
  private pc: RTCPeerConnection | null = null;
  private attempts = 0;
  private closed = false;

  constructor(
    private readonly session: cast.framework.CastSession,
    private readonly track: MediaStreamTrack,
    private readonly onState: (state: StreamState) => void,
  ) {
    session.addMessageListener(CAST_NAMESPACE, this.onMessage);
  }

  start(): void {
    void this.negotiate();
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;
    this.attempts++;
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    this.onState('connecting');
    const transceiver = pc.addTransceiver(this.track, {
      direction: 'sendonly',
      sendEncodings: [{ maxBitrate: MAX_BITRATE, maxFramerate: 60 }],
    });
    const codecs = preferredCodecs();
    if (codecs) {
      try { transceiver.setCodecPreferences(codecs); } catch { /* keep the browser's order */ }
    }
    pc.addEventListener('connectionstatechange', () => {
      if (pc !== this.pc || this.closed) return;
      if (pc.connectionState === 'connected') {
        this.attempts = 0;
        this.onState('connected');
      } else if (pc.connectionState === 'failed') {
        this.retry('connection failed');
      }
    });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await iceGatheringDone(pc);
      if (pc !== this.pc || this.closed) return;
      await this.session.sendMessage(CAST_NAMESPACE, { type: 'offer', sdp: pc.localDescription!.sdp });
    } catch (err) {
      this.retry(err);
    }
  }

  private retry(reason: unknown): void {
    console.warn('VoltViz: Cast stream', reason);
    if (this.attempts < MAX_ATTEMPTS) void this.negotiate();
    else this.onState('failed');
  }

  private readonly onMessage = (_ns: string, raw: string) => {
    const msg = parseCastMessage(raw);
    const pc = this.pc;
    if (!msg || !pc || this.closed) return;
    if (msg.type === 'answer' && pc.signalingState === 'have-local-offer') {
      pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(err => this.retry(err));
    } else if (msg.type === 'error') {
      this.retry(`receiver: ${msg.message}`);
    }
  };

  close(): void {
    this.closed = true;
    this.session.removeMessageListener(CAST_NAMESPACE, this.onMessage);
    this.pc?.close();
    this.pc = null;
  }
}
