import { useEffect, useRef, useState } from 'react';
import { Heart, X } from 'lucide-react';
import type { SkinDefinition } from '../skins';
import { artistNames, maApi, pickImage, type MaMediaItem, type MaPlayerQueue, type MusicAssistantApi } from '../audio/sources/musicAssistant';
import { favoritesFirst, playOption } from './sendspinView';
import { errorText } from './useMusicAssistant';
import SendspinMediaRow from './SendspinMediaRow';

interface SendspinMediaPickerProps {
  skin: SkinDefinition;
  ma: MusicAssistantApi;
  queue: MaPlayerQueue | null;
  playerId: string;
  onClose: () => void;
}

type Tab = 'playlists' | 'recent' | 'search';
const TABS: { id: Tab; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'recent', label: 'Recent' },
  { id: 'search', label: 'Search' },
];

const TYPE_LABEL: Record<string, string> = { playlist: 'Playlist', album: 'Album', artist: 'Artist', track: 'Track', radio: 'Radio' };
const PLAYABLE = new Set(Object.keys(TYPE_LABEL));

const describe = (item: MaMediaItem) => [TYPE_LABEL[item.media_type] ?? item.media_type, artistNames(item)].filter(Boolean).join(' · ');

/** Loads a list once per key and keeps it while the picker is open. */
function useMaList<T>(key: string | null, load: () => Promise<T>) {
  const cache = useRef(new Map<string, T>());
  const [, rerender] = useState(0);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null || cache.current.has(key)) return;
    let cancelled = false;
    loadRef.current().then(
      data => {
        if (cancelled) return;
        cache.current.set(key, data);
        rerender(n => n + 1);
      },
      err => {
        if (!cancelled) setError({ key, message: errorText(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const data = key === null ? undefined : cache.current.get(key);
  const failed = error !== null && error.key === key;
  return { data, error: failed ? error.message : null, loading: key !== null && data === undefined && !failed };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Start music from the Music Assistant library on this player. */
export default function SendspinMediaPicker({ skin, ma, queue, playerId, onClose }: SendspinMediaPickerProps) {
  const [tab, setTab] = useState<Tab>('playlists');
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim(), 350);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const library = useMaList(tab === 'playlists' ? 'playlists' : null, async () => {
    const [favorites, all, radios] = await Promise.all([
      maApi.playlists(ma, true),
      maApi.playlists(ma),
      maApi.radios(ma).catch(() => [] as MaMediaItem[]),
    ]);
    return { playlists: favoritesFirst(favorites ?? [], all ?? []), radios: radios ?? [] };
  });
  const recent = useMaList(tab === 'recent' ? 'recent' : null, async () =>
    ((await maApi.recentlyPlayed(ma)) ?? []).filter(item => PLAYABLE.has(item.media_type)));
  const results = useMaList(tab === 'search' && search.length >= 2 ? `search:${search}` : null, () => maApi.search(ma, search));

  const start = async (item: MaMediaItem) => {
    setStarting(item.uri);
    setStartError(null);
    try {
      await maApi.playMedia(ma, queue?.queue_id ?? playerId, item.uri, playOption(queue));
      onClose();
    } catch (err) {
      setStartError(errorText(err));
    } finally {
      setStarting(null);
    }
  };

  const renderItems = (items: MaMediaItem[], subtitle: (item: MaMediaItem) => string = describe) => (
    <ul>
      {items.map(item => (
        <SendspinMediaRow
          key={item.uri}
          skin={skin}
          imageUrl={ma.imageUrl(pickImage(item), 80)}
          title={item.name}
          subtitle={subtitle(item)}
          trailing={item.favorite ? <Heart size={12} fill="currentColor" className="opacity-60 flex-shrink-0" aria-label="Favorite" /> : undefined}
          busy={starting === item.uri}
          disabled={starting !== null}
          onClick={() => start(item)}
          testId="sendspin-media-item"
        />
      ))}
    </ul>
  );

  const section = (title: string, items: MaMediaItem[] | undefined) =>
    items && items.length > 0 ? (
      <div key={title} className="space-y-1">
        <h4 className={`${skin.sendspinListMeta} uppercase tracking-wider px-2 pt-2`}>{title}</h4>
        {renderItems(items)}
      </div>
    ) : null;

  const status = (loading: boolean, error: string | null, empty: boolean, emptyText: string) =>
    loading ? <p className={`${skin.sendspinListMeta} py-4 text-center`}>Loading…</p>
      : error ? <p className={`${skin.sendspinListMeta} py-4 text-center`} role="alert">{error}</p>
        : empty ? <p className={`${skin.sendspinListMeta} py-4 text-center`}>{emptyText}</p>
          : null;

  const searchResults = results.data;
  const searchEmpty = !!searchResults && !['playlists', 'albums', 'artists', 'tracks', 'radio'].some(k => (searchResults[k as keyof typeof searchResults]?.length ?? 0) > 0);

  return (
    <div className={skin.sendspinPanel} role="dialog" aria-label="Start music" data-testid="sendspin-picker">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={tab === t.id ? skin.sendspinTabActive : skin.sendspinTab}
              data-testid={`sendspin-picker-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className={skin.pickerClose} aria-label="Close picker" title="Close">
          <X size={18} />
        </button>
      </div>

      {tab === 'search' && (
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search playlists, albums, artists, tracks…"
          className={skin.dialogInput}
          autoFocus
          aria-label="Search Music Assistant"
          data-testid="sendspin-picker-search"
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="tabpanel">
        {tab === 'playlists' && (
          status(library.loading, library.error, !!library.data && library.data.playlists.length === 0 && library.data.radios.length === 0, 'No playlists in your library yet')
          ?? (library.data && (
            library.data.radios.length > 0
              ? <>{section('Playlists', library.data.playlists)}{section('Radio', library.data.radios)}</>
              : renderItems(library.data.playlists, item => artistNames(item) || 'Playlist')
          ))
        )}
        {tab === 'recent' && (
          status(recent.loading, recent.error, !!recent.data && recent.data.length === 0, 'Nothing played yet')
          ?? (recent.data && renderItems(recent.data))
        )}
        {tab === 'search' && (
          search.length < 2
            ? <p className={`${skin.sendspinListMeta} py-4 text-center`}>Type at least 2 characters</p>
            : status(results.loading, results.error, searchEmpty, `Nothing found for “${search}”`)
              ?? (searchResults && (
                <>
                  {section('Playlists', searchResults.playlists)}
                  {section('Albums', searchResults.albums)}
                  {section('Artists', searchResults.artists)}
                  {section('Tracks', searchResults.tracks)}
                  {section('Radio', searchResults.radio)}
                </>
              ))
        )}
        {startError && <p className={`${skin.sendspinListMeta} pt-2`} role="alert">{startError}</p>}
      </div>
    </div>
  );
}
