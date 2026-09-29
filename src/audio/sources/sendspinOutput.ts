/**
 * The audio VoltViz visualizes from a Sendspin player. Kept free of the SDK runtime so the unit
 * tests can load it without a browser.
 *
 * The SDK normally plays through the audio element VoltViz hands it, as a MediaStream, and that
 * stream is what gets visualized. On Android it does not: it plays straight to the speakers and
 * gives the element a looping, almost silent file instead (so the phone shows media controls),
 * which leaves no stream to visualize. Then the SDK's output gain node is tapped instead.
 */

/** The internals of sendspin-js 5's SendspinPlayer that the tap needs. */
type PlayerInternals = { scheduler?: { audioContext?: AudioContext | null; gainNode?: GainNode | null } | null };

/**
 * A MediaStream of what the player plays, from its output gain node (after its volume). Null
 * until the player has an AudioContext, or when the SDK is shaped differently (then there is no
 * visualizer on Android, as before).
 */
export function tapPlayerOutput(player: unknown): MediaStream | null {
  const scheduler = (player as PlayerInternals | null)?.scheduler;
  const context = scheduler?.audioContext;
  const gain = scheduler?.gainNode;
  if (!context || !gain || typeof context.createMediaStreamDestination !== 'function') return null;
  const destination = context.createMediaStreamDestination();
  gain.connect(destination);
  return destination.stream;
}
