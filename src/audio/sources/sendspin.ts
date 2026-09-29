/**
 * Sendspin (Music Assistant) audio source: activation handshake, activation timeout,
 * reconnects, the prefixed identity storage, and the Music Assistant API connection that
 * comes with it inside the Home Assistant add-on.
 */
import { SendspinPlayer } from '@sendspin/sendspin-js';
import type { ControllerCommand, ControllerCommands, SendspinStorage } from '@sendspin/sendspin-js';
import { configurePlayerInMA, discoverMusicAssistant, MusicAssistantClient, type MusicAssistantApi } from './musicAssistant';
import { initialSendspinState, mapSdkState, SENDSPIN_RECONNECT_ATTEMPTS, type SendspinSession, type SendspinState, type TrackProgress } from './sendspinState';

export { initialSendspinState, type SendspinSession, type SendspinState, type TrackProgress } from './sendspinState';

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
  /** Music Assistant's API became available (inside the Home Assistant add-on), or went away. */
  onMusicAssistant?(ma: MusicAssistantApi | null): void;
}

export class SendspinController implements SendspinSession {
  private player: SendspinPlayer | null = null;
  private audio: HTMLAudioElement | null = null;
  private activated = false;
  private activationTimeout: number | null = null;
  private ma: MusicAssistantClient | null = null;
  /** Bumped by cleanup() so a Music Assistant lookup still under way is dropped. */
  private maSession = 0;
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
          maxAttempts: SENDSPIN_RECONNECT_ATTEMPTS,
          // The bar shows the attempts; the banner only reports it when they run out
          onReconnecting: (attempt) => cb.onState({ reconnectAttempt: attempt }),
          onReconnected: () => {
            cb.onState({ reconnectAttempt: 0 });
            cb.onError(null);
          },
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
            cb.onState({ active: true, playerId: player.clientId });
            cb.onActivated();
            // The audio element usually started playing before activation, so
            // the 'playing' listener has already come and gone — pick up the
            // stream here.
            if (audioEl.srcObject instanceof MediaStream) {
              cb.onStream(audioEl.srcObject);
            }
            void this.startMusicAssistant(player.clientId);
          }
          cb.onState(mapSdkState(state));
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

  command<T extends ControllerCommand>(command: T, params?: ControllerCommands[T]): boolean {
    if (!this.player) return false;
    try {
      // Throws when the server does not list the command as supported
      this.player.sendCommand(command, params as never);
      return true;
    } catch (err) {
      console.warn(`VoltViz: Sendspin command '${command}' failed`, err);
      return false;
    }
  }

  seek(positionMs: number): boolean {
    if (!this.player) return false;
    try {
      // 'seek' is in the Sendspin spec (and Music Assistant 2.10) but not yet in sendspin-js
      // 5.0.0's ControllerCommands. The SDK checks it against the server's supported commands
      // and forwards the parameters as they are.
      (this.player as unknown as { sendCommand(command: string, params: object): void })
        .sendCommand('seek', { position_ms: Math.max(0, Math.round(positionMs)) });
      return true;
    } catch (err) {
      console.warn('VoltViz: Sendspin seek failed', err);
      return false;
    }
  }

  get trackProgress(): TrackProgress | null {
    // Before the clock is synced the SDK's extrapolation is meaningless
    if (!this.player || !this.activated || !this.player.timeSyncInfo.synced) return null;
    return this.player.trackProgress;
  }

  private async startMusicAssistant(playerId: string): Promise<void> {
    const session = ++this.maSession;
    const endpoint = await discoverMusicAssistant();
    if (!endpoint || session !== this.maSession || !this.player) return;
    const ma = new MusicAssistantClient(endpoint);
    this.ma = ma;
    ma.connect();
    this.cb.onMusicAssistant?.(ma);
    void configurePlayerInMA(ma, playerId);
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
    this.maSession++;
    if (this.ma) {
      this.ma.close();
      this.ma = null;
      this.cb.onMusicAssistant?.(null);
    }
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
