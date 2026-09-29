import { useState } from 'react';
import { ListPlus, X } from 'lucide-react';
import type { SkinDefinition } from '../skins';
import { artistNames, maApi, pickImage, type MaPlayerQueue, type MaQueueItem, type MusicAssistantApi } from '../audio/sources/musicAssistant';
import { formatTime } from './sendspinView';
import { errorText, useMaQueueItems } from './useMusicAssistant';
import SendspinMediaRow from './SendspinMediaRow';

interface SendspinQueuePanelProps {
  skin: SkinDefinition;
  ma: MusicAssistantApi;
  queue: MaPlayerQueue | null;
  onAddMusic: () => void;
  onClose: () => void;
}

/** The current and upcoming tracks of the Music Assistant queue; tap one to play it. */
export default function SendspinQueuePanel({ skin, ma, queue, onAddMusic, onClose }: SendspinQueuePanelProps) {
  const { items, error } = useMaQueueItems(ma, queue, true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const currentId = queue?.current_item?.queue_item_id ?? null;
  const empty = queue !== null && (queue.items === 0 || items?.length === 0);

  const play = async (item: MaQueueItem) => {
    if (!queue) return;
    setBusyId(item.queue_item_id);
    setActionError(null);
    try {
      await maApi.playIndex(ma, queue.queue_id, item.queue_item_id);
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={skin.sendspinPanel} role="dialog" aria-label="Queue" data-testid="sendspin-queue-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className={skin.sendspinPanelTitle}>Up next{queue && queue.items > 0 ? ` · ${queue.items}` : ''}</h3>
        <div className="flex items-center gap-2">
          <button onClick={onAddMusic} className={`${skin.sendspinTab} flex items-center gap-1`} data-testid="sendspin-add-music">
            <ListPlus size={14} /> Add music
          </button>
          <button onClick={onClose} className={skin.pickerClose} aria-label="Close queue" title="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {empty ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className={skin.sendspinListMeta}>The queue is empty</p>
            <button onClick={onAddMusic} className={`${skin.sendspinTab} flex items-center gap-1`}>
              <ListPlus size={14} /> Pick something to play
            </button>
          </div>
        ) : items ? (
          <ul data-testid="sendspin-queue-items">
            {items.map(item => (
              <SendspinMediaRow
                key={item.queue_item_id}
                skin={skin}
                imageUrl={ma.imageUrl(pickImage(item), 80)}
                title={item.media_item?.name ?? item.name}
                subtitle={artistNames(item.media_item) || undefined}
                trailing={item.duration ? <span className={skin.sendspinListMeta}>{formatTime(item.duration * 1000)}</span> : undefined}
                active={item.queue_item_id === currentId}
                busy={busyId === item.queue_item_id}
                disabled={busyId !== null || item.available === false}
                onClick={() => play(item)}
                testId="sendspin-queue-item"
              />
            ))}
          </ul>
        ) : !error ? (
          <p className={`${skin.sendspinListMeta} py-4 text-center`}>Loading…</p>
        ) : null}
        {(actionError ?? error) && <p className={`${skin.sendspinListMeta} pt-2`} role="alert">{actionError ?? error}</p>}
      </div>
    </div>
  );
}
