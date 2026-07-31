import { useEffect, useRef } from 'react';
import { X, ImageOff, Shuffle, Check } from 'lucide-react';
import { visualizers } from '../visualizers';
import type { VisualizerType } from '../visualizers';
import type { SkinDefinition } from '../skins';

// Only the hashed asset URLs are inlined here; the images themselves load
// lazily as cards scroll into view.
const previewUrls = import.meta.glob<string>('../images/previews/*.jpg', {
  eager: true,
  import: 'default',
  query: '?url',
});

const previewFor = (id: string): string | undefined =>
  previewUrls[`../images/previews/${id}.jpg`];

interface VisualizerPickerProps {
  active: VisualizerType;
  skin: SkinDefinition;
  shufflePool: readonly VisualizerType[];
  onTogglePool: (id: VisualizerType) => void;
  onSelect: (id: VisualizerType) => void;
  onClose: () => void;
}

export default function VisualizerPicker({ active, skin, shufflePool, onTogglePool, onSelect, onClose }: VisualizerPickerProps) {
  const activeCardRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    activeCardRef.current?.focus();
    activeCardRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <div
      className={skin.dialogOverlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose visualizer"
      data-testid="visualizer-picker"
    >
      <div className={skin.pickerPanel} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h3 className={skin.pickerTitle}>Visualizers</h3>
          <button onClick={onClose} className={skin.pickerClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 overflow-y-auto p-1 pr-2">
          {visualizers.map(v => {
            const url = previewFor(v.id);
            const isActive = v.id === active;
            const inPool = shufflePool.includes(v.id);
            return (
              // Cards and shuffle badges are sibling buttons (nesting them is invalid HTML)
              <div key={v.id} className="relative">
                <button
                  onClick={() => onTogglePool(v.id)}
                  className={`absolute top-2 right-2 z-10 ${inPool ? skin.pickerBadgeActive : skin.pickerBadge}`}
                  aria-pressed={inPool}
                  title={inPool ? 'Remove from shuffle' : 'Include in shuffle'}
                  data-testid={`viz-pool-${v.id}`}
                >
                  <Shuffle size={12} />
                  {inPool && <Check size={12} />}
                </button>
                <button
                  ref={isActive ? activeCardRef : undefined}
                  onClick={() => {
                    onSelect(v.id);
                    onClose();
                  }}
                  className={`w-full ${skin.pickerCard} ${isActive ? skin.pickerCardActive : ''}`}
                  aria-pressed={isActive}
                  data-testid={`viz-card-${v.id}`}
                >
                  {/* The aspect box lives on a plain div, and the card button must not be
                      overflow-hidden: either way an aspect-sized lazy image contributes no
                      height during grid row sizing, collapsing the rows on first open. */}
                  <div className="relative w-full aspect-video overflow-hidden rounded-t-[inherit]">
                    {url ? (
                      <img src={url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-black/40 to-black/10">
                        <ImageOff size={24} className="opacity-40" />
                      </div>
                    )}
                  </div>
                  <span className={skin.pickerCardLabel}>{v.name}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
