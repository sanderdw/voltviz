/**
 * Shuffle and repeat for the Sendspin bar. Inside the Home Assistant add-on Music Assistant's
 * queue is the source and changes go through its API, which says when it refuses one; elsewhere
 * they go over Sendspin. Either way a change shows right away (see withPending).
 */
import { useState } from 'react';
import type { ControllerCommand } from '@sendspin/sendspin-js';
import { maApi, type MaPlayerQueue, type MusicAssistantApi } from '../audio/sources/musicAssistant';
import type { SendspinState } from '../audio/sources/sendspinState';
import { asRepeatMode, nextRepeatMode, withPending, type PendingChange } from './sendspinView';

/** `send` returns false when the command could not be sent, or a promise that rejects when it is refused. */
type Send = () => boolean | Promise<unknown>;

function usePendingChange<T>(server: T, revision: unknown) {
  const [pending, setPending] = useState<PendingChange<T> | null>(null);
  const change = (value: T, send: Send) => {
    const sent = send();
    if (sent === false) return;
    const next: PendingChange<T> = { value, base: server, revision };
    setPending(next);
    if (sent instanceof Promise) {
      sent.catch(err => {
        console.warn('VoltViz: Music Assistant did not change shuffle or repeat', err);
        setPending(p => (p === next ? null : p));
      });
    }
  };
  return [withPending(server, revision, pending), change] as const;
}

export function usePlaybackModes({ sendspin, command, ma, queue }: {
  sendspin: SendspinState;
  command: (command: ControllerCommand) => boolean;
  ma: MusicAssistantApi | null;
  queue: MaPlayerQueue | null;
}) {
  const maQueue = ma && queue ? { ma, queue } : null;
  const revision = maQueue ? maQueue.queue : sendspin.metadata;
  const [shuffle, changeShuffle] = usePendingChange(maQueue ? !!maQueue.queue.shuffle_enabled : !!sendspin.shuffle, revision);
  const [repeat, changeRepeat] = usePendingChange(asRepeatMode(maQueue ? maQueue.queue.repeat_mode : sendspin.repeat), revision);
  const nextRepeat = nextRepeatMode(repeat);
  const shuffleCommand = shuffle ? 'unshuffle' : 'shuffle';
  const repeatCommand = `repeat_${nextRepeat}` as const;
  // Music Assistant refuses both on a dynamic queue, a smart mix it keeps filling itself
  const locked = !!maQueue?.queue.is_dynamic;

  return {
    shuffle,
    repeat,
    canShuffle: maQueue ? !locked : sendspin.supportedCmds.includes(shuffleCommand),
    canRepeat: maQueue ? !locked : sendspin.supportedCmds.includes(repeatCommand),
    toggleShuffle: () => changeShuffle(!shuffle, () =>
      (maQueue ? maApi.setShuffle(maQueue.ma, maQueue.queue.queue_id, !shuffle) : command(shuffleCommand))),
    cycleRepeat: () => changeRepeat(nextRepeat, () =>
      (maQueue ? maApi.setRepeat(maQueue.ma, maQueue.queue.queue_id, nextRepeat) : command(repeatCommand))),
  };
}
