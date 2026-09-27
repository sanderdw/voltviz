/**
 * Sendspin (Music Assistant) audio source. Extracted unchanged from the previous App.tsx:
 * activation handshake, activation timeout, reconnects, Music Assistant auto-configuration
 * and the prefixed identity storage.
 */
import { SendspinPlayer } from '@sendspin/sendspin-js';
import type { ControllerCommand, ControllerCommands, SendspinStorage, ServerStateMetadata } from '@sendspin/sendspin-js';

export type SendspinState = {
  active: boolean;
  playing: boolean;
  metadata: ServerStateMetadata | null;
  supportedCmds: string[];
  volume: number;
  muted: boolean;
};

export const initialSendspinState: SendspinState = {
  active: false,
  playing: false,
  metadata: null,
  supportedCmds: [],
  volume: 100,
  muted: false,
};

// The Sendspin SDK persists its identity keypair (whose public key is the
// client id, which Music Assistant uses as the player id) under bare
// localStorage keys such as `sendspin-identity-sk`. Music Assistant's own
// frontend uses the same SDK with the same defaults, and under Home Assistant
// Ingress both apps are same-origin, so without a prefix they share one
// identity and collapse into a single MA player whose name flips between
// "VoltViz" and MA's web player on every (re)connect. Prefixing every key
// gives VoltViz its own, still persistent, identity. Access is guarded so a
// throwing localStorage (sandboxed iframe, private mode, quota) degrades to a
// per-session identity instead of failing player construction.
const SENDSPIN_STORAGE_PREFIX = 'voltviz:';
const sendspinStorage: SendspinStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(SENDSPIN_STORAGE_PREFIX + key);
    } catch (err) {
      console.warn('VoltViz: localStorage unavailable, Sendspin identity will not persist', err);
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(SENDSPIN_STORAGE_PREFIX + key, value);
    } catch (err) {
      console.warn('VoltViz: localStorage unavailable, Sendspin identity will not persist', err);
    }
  },
};

export interface SendspinCallbacks {
  /** The audio stream to visualize (may be called repeatedly with the same stream). */
  onStream(stream: MediaStream): void;
  onState(patch: Partial<SendspinState>): void;
  onError(message: string | null): void;
  onConnecting(connecting: boolean): void;
  /** The server activated the player: the connect dialog can close. */
  onActivated(): void;
  /** The connection is gone for good (reconnects exhausted, activation timeout). */
  onClosed(): void;
}

const saveMAPlayerConfig = (wsUrl: string, playerId: string) => new Promise<boolean>(resolve => {
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    resolve(false);
    return;
  }
  let settled = false;
  const done = (ok: boolean) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    try { ws.close(); } catch { /* already closed */ }
    resolve(ok);
  };
  const timer = window.setTimeout(() => done(false), 5000);
  const msgId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  let commandSent = false;

  ws.onmessage = (event) => {
    let msg: any;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (!commandSent && msg.server_version) {
      commandSent = true;
      ws.send(JSON.stringify({
        message_id: msgId,
        command: 'config/players/save',
        args: { player_id: playerId, values: { hide_in_ui: false, expose_player_to_ha: true } }
      }));
    } else if (msg.message_id === msgId) {
      done(!('error_code' in msg));
    }
  };
  ws.onerror = () => done(false);
  ws.onclose = () => done(false);
});

// Music Assistant registers Sendspin web players hidden and not exposed to
// Home Assistant; flip both so the player is usable as soon as it appears.
// Only possible inside the HA add-on, where run.sh publishes MA's ingress
// entry as ma-config.json. MA may not have finished registering the player
// when the first server state arrives, hence the retries.
async function configurePlayerInMA(playerId: string): Promise<void> {
  let ingressPath: string;
  try {
    const configResp = await fetch(new URL('ma-config.json', window.location.href).href);
    if (!configResp.ok) return;
    const { ingress_entry } = await configResp.json();
    if (!ingress_entry) return;
    ingressPath = ingress_entry.endsWith('/') ? ingress_entry : ingress_entry + '/';
  } catch { /* not running in HA add-on context */
    return;
  }

  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${window.location.host}${ingressPath}ws`;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
    if (await saveMAPlayerConfig(wsUrl, playerId)) return;
  }
}

export class SendspinController {
  private player: SendspinPlayer | null = null;
  private audio: HTMLAudioElement | null = null;
  private activated = false;
  private activationTimeout: number | null = null;
  private readonly cb: SendspinCallbacks;

  constructor(callbacks: SendspinCallbacks) {
    this.cb = callbacks;
  }

  get connected(): boolean {
    return this.player !== null;
  }

  async connect(serverUrl: string): Promise<void> {
    const cb = this.cb;
    try {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      this.audio = audioEl;

      audioEl.addEventListener('playing', () => {
        // Don't start the visualizer before the server has activated the
        // player: the element plays the SDK's (still silent) MediaStream as
        // soon as connect() resolves, even when the handshake later fails.
        if (this.activated && audioEl.srcObject instanceof MediaStream) {
          cb.onStream(audioEl.srcObject);
        }
      });

      const player = new SendspinPlayer({
        baseUrl: serverUrl,
        audioElement: audioEl,
        clientName: 'VoltViz',
        // Music Assistant only treats a client as a standalone web player when
        // product_name is one of its known web/app values ("Web Browser",
        // "Web Player", "Mobile Application", "PWA"). Anything else is
        // classified as a PROTOCOL endpoint and wrapped in a hidden
        // auto-created "universal player", making VoltViz unusable in MA.
        productName: 'Web Player',
        // Own key namespace so VoltViz never shares its Sendspin identity (and
        // thus its MA player id) with the Music Assistant web player when both
        // run same-origin under HA Ingress. See sendspinStorage above.
        storage: sendspinStorage,
        correctionMode: 'quality-local',
        reconnect: {
          maxAttempts: 10,
          onReconnecting: (attempt) => cb.onError(`Sendspin connection lost — reconnecting (attempt ${attempt}/10)…`),
          onReconnected: () => cb.onError(null),
          onExhausted: () => {
            cb.onError('Sendspin connection lost — could not reconnect');
            this.cleanup();
            cb.onClosed();
          },
        },
        onStateChange: (state) => {
          // A non-empty serverState is the first proof the player is actually
          // registered: the SDK initializes it to {} and only merges content
          // into it from server/state messages, which the server sends only
          // after activation. The socket opening alone proves nothing.
          if (state.serverState && Object.keys(state.serverState).length > 0 && !this.activated) {
            this.activated = true;
            this.clearActivationTimeout();
            cb.onConnecting(false);
            cb.onError(null);
            cb.onState({ active: true });
            cb.onActivated();
            // The audio element usually started playing before activation, so
            // the 'playing' listener has already come and gone — pick up the
            // stream here.
            if (audioEl.srcObject instanceof MediaStream) {
              cb.onStream(audioEl.srcObject);
            }
            configurePlayerInMA(player.clientId);
          }
          const patch: Partial<SendspinState> = { playing: state.isPlaying };
          if (state.serverState?.metadata) {
            patch.metadata = state.serverState.metadata;
          }
          if (state.serverState?.controller?.supported_commands) {
            patch.supportedCmds = state.serverState.controller.supported_commands;
          }
          if (state.serverState?.controller?.volume !== undefined) {
            patch.volume = state.serverState.controller.volume;
          }
          if (state.serverState?.controller?.muted !== undefined) {
            patch.muted = state.serverState.controller.muted;
          }
          cb.onState(patch);
          if (state.isPlaying && audioEl.srcObject instanceof MediaStream) {
            cb.onStream(audioEl.srcObject);
            // Ensure playback on mobile where autoplay may be blocked
            if (audioEl.paused) {
              audioEl.play().catch(() => {});
            }
          }
        }
      });

      this.player = player;
      this.activated = false;
      cb.onConnecting(true);
      await player.unlock();
      await player.connect();
      // Kick-start playback on mobile where autoplay may be blocked
      audioEl.play().catch(() => {});

      cb.onError(null);
      // A handshake failure after the socket opens closes it again without any
      // callback, so give the server a bounded window to activate the player.
      this.activationTimeout = window.setTimeout(() => {
        this.activationTimeout = null;
        if (!this.activated) {
          cb.onError('Connected, but the server never activated the player — check that Music Assistant is 2.10.0b14 or newer and its Sendspin pairing settings.');
          this.cleanup();
          cb.onClosed();
        }
      }, 10000);
    } catch (err: any) {
      cb.onError(err.message || 'Failed to connect to Sendspin server');
      this.cleanup();
      cb.onClosed();
    }
  }

  command<T extends ControllerCommand>(command: T, params?: ControllerCommands[T]): void {
    this.player?.sendCommand(command, params as never);
  }

  private clearActivationTimeout(): void {
    if (this.activationTimeout !== null) {
      window.clearTimeout(this.activationTimeout);
      this.activationTimeout = null;
    }
  }

  /** Disconnect and release everything (idempotent). */
  cleanup(): void {
    this.clearActivationTimeout();
    this.activated = false;
    this.cb.onConnecting(false);
    if (this.player) {
      this.player.disconnect('user_request');
      this.player = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio = null;
    }
    this.cb.onState(initialSendspinState);
  }
}
