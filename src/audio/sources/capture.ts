/**
 * Microphone and system-audio capture. Behaviour identical to the previous App.tsx code:
 * raw capture (no AGC / echo cancellation / noise suppression in the browser), and system
 * audio requires "Share audio" to be ticked.
 */
const RAW_AUDIO: MediaTrackConstraints = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
};

/**
 * Why there is no capture: browsers only offer it on https:// pages (and localhost), and phones
 * and tablets can't share their screen or system audio at all.
 */
export function captureUnavailable(source: 'microphone' | 'system audio'): Error {
  if (globalThis.isSecureContext === false) {
    return new Error(`Browsers only allow ${source === 'microphone' ? 'the microphone' : 'system audio'} on secure (https://) pages, and this one was opened over http://. Open VoltViz over https://, or use Sendspin.`);
  }
  return new Error(source === 'microphone'
    ? 'This browser does not offer microphone access.'
    : 'This browser can\'t share system audio (phones and tablets can\'t). Use Sendspin or the microphone.');
}

export async function captureMicrophone(): Promise<MediaStream> {
  // navigator.mediaDevices itself is missing on an http:// page
  if (!navigator.mediaDevices?.getUserMedia) throw captureUnavailable('microphone');
  return navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
}

/**
 * Screen/tab capture with audio. `onEnded` fires when the user stops sharing from the
 * browser UI.
 */
export async function captureSystemAudio(onEnded: () => void): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw captureUnavailable('system audio');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: RAW_AUDIO });
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('No audio found. Please make sure to check "Share audio" when selecting the screen/tab.');
  }
  stream.getVideoTracks()[0].onended = onEnded;
  return stream;
}
