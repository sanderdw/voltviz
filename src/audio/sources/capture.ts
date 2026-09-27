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

export async function captureMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
}

/**
 * Screen/tab capture with audio. `onEnded` fires when the user stops sharing from the
 * browser UI.
 */
export async function captureSystemAudio(onEnded: () => void): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: RAW_AUDIO });
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('No audio found. Please make sure to check "Share audio" when selecting the screen/tab.');
  }
  stream.getVideoTracks()[0].onended = onEnded;
  return stream;
}
