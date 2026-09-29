import { useState, type ReactNode } from 'react';
import { LoaderCircle, Music } from 'lucide-react';
import type { SkinDefinition } from '../skins';

interface SendspinMediaRowProps {
  skin: SkinDefinition;
  imageUrl: string | null;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}

/** One playable item in the queue panel or the media picker. */
export default function SendspinMediaRow({ skin, imageUrl, title, subtitle, trailing, active, busy, disabled, onClick, testId }: SendspinMediaRowProps) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return (
    <li>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`${skin.sendspinListItem} ${active ? skin.sendspinListItemActive : ''}`}
        aria-current={active ? 'true' : undefined}
        data-testid={testId}
      >
        <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center overflow-hidden rounded">
          {busy ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : imageUrl && imageUrl !== failedImage ? (
            // Music Assistant answers 404 for artwork it can no longer fetch (a removed Spotify cover)
            <img src={imageUrl} alt="" loading="lazy" className="w-8 h-8 object-cover" onError={() => setFailedImage(imageUrl)} />
          ) : (
            <Music size={16} className="opacity-50" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{title}</span>
          {subtitle && <span className={`block ${skin.sendspinListMeta}`}>{subtitle}</span>}
        </span>
        {trailing}
      </button>
    </li>
  );
}
