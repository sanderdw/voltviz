/**
 * The VoltViz Cast receiver (runs on the Chromecast, see cast-receiver.html). It shows the
 * sender's composited visualizer as a WebRTC video stream; there is no audio. A new offer (sender
 * reloaded or renegotiating) replaces the current connection.
 */
import type * as Framework from 'chromecast-caf-receiver/cast.framework';
import type * as System from 'chromecast-caf-receiver/cast.framework.system';
import { CAST_NAMESPACE, ICE_SERVERS, iceGatheringDone, parseCastMessage, type CastMessage } from './protocol';

// The receiver framework's global (its types clash with the sender's global `cast`, so they are imported)
const { framework } = (window as unknown as { cast: { framework: typeof Framework & { system: typeof System } } }).cast;

const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status')!;
const context = framework.CastReceiverContext.getInstance();

let pc: RTCPeerConnection | null = null;
let owner: string | null = null;

function showIdle(text: string): void {
  document.body.classList.remove('playing');
  status.textContent = text;
}

function send(senderId: string, msg: CastMessage): void {
  context.sendCustomMessage(CAST_NAMESPACE, senderId, msg);
}

function closeConnection(): void {
  pc?.close();
  pc = null;
  owner = null;
  video.srcObject = null;
}

async function answer(senderId: string, sdp: string): Promise<void> {
  closeConnection();
  const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc = conn;
  owner = senderId;
  showIdle('Connecting…');
  conn.ontrack = e => {
    // Lowest latency: the picture should follow the music as closely as possible
    try { (e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number }).jitterBufferTarget = 0; } catch { /* unsupported */ }
    video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    video.play().catch(() => {});
  };
  conn.onconnectionstatechange = () => {
    if (conn !== pc) return;
    if (conn.connectionState === 'connected') document.body.classList.add('playing');
    else if (conn.connectionState === 'failed' || conn.connectionState === 'closed') showIdle('Connection lost. Waiting for VoltViz…');
  };
  try {
    await conn.setRemoteDescription({ type: 'offer', sdp });
    await conn.setLocalDescription(await conn.createAnswer());
    await iceGatheringDone(conn);
    if (conn !== pc) return;
    send(senderId, { type: 'answer', sdp: conn.localDescription!.sdp });
  } catch (err) {
    console.error('VoltViz receiver: negotiation failed', err);
    if (conn === pc) send(senderId, { type: 'error', message: String(err) });
  }
}

context.addCustomMessageListener(CAST_NAMESPACE, (e: System.Message) => {
  const msg = parseCastMessage(e.data);
  if (msg?.type === 'offer') void answer(e.senderId, msg.sdp);
});

context.addEventListener(framework.system.EventType.SENDER_DISCONNECTED, (e: System.SenderDisconnectedEvent) => {
  if (e.senderId !== owner) return;
  closeConnection();
  showIdle('Waiting for VoltViz…');
});

context.start({
  customNamespaces: { [CAST_NAMESPACE]: framework.system.MessageType.JSON },
  disableIdleTimeout: true,
  skipPlayersLoad: true,
  statusText: 'VoltViz',
} as Framework.CastReceiverOptions);
