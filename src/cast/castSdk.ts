/// <reference types="chromecast-caf-sender" />
/**
 * Loads the Google Cast sender framework on demand (Chromium only, secure context only) and
 * configures it for the VoltViz receiver. Resolves to the CastContext, or null where casting
 * can't work (other browsers, http, no receiver app ID, script blocked).
 */
import { CAST_APP_ID } from './protocol';

const SENDER_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

let loading: Promise<cast.framework.CastContext | null> | null = null;

export function castSupported(): boolean {
  return Boolean(CAST_APP_ID) && window.isSecureContext && typeof RTCPeerConnection !== 'undefined'
    && 'chrome' in window && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export function loadCastContext(): Promise<cast.framework.CastContext | null> {
  if (!castSupported()) return Promise.resolve(null);
  loading ??= new Promise(resolve => {
    window.__onGCastApiAvailable = available => {
      if (!available) {
        resolve(null);
        return;
      }
      try {
        const context = cast.framework.CastContext.getInstance();
        context.setOptions({
          receiverApplicationId: CAST_APP_ID,
          autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
          resumeSavedSession: true,
        });
        resolve(context);
      } catch (err) {
        console.error('VoltViz: Cast framework failed to start', err);
        resolve(null);
      }
    };
    const script = document.createElement('script');
    script.src = SENDER_URL;
    script.async = true;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loading;
}
