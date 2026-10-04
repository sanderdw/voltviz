/**
 * Image upload overlay for visualizers that show a picture (the cover art of the Sendspin track
 * by default): an uploaded image replaces it until the visualizer is switched.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent, ComponentType } from 'react';
import { ImagePlus, Eye, EyeOff } from 'lucide-react';
import type { OverlayProps } from '../runtime/types';

export type ImageUploadApi = { setImage(url: string): void };

/** An Overlay with an "Upload <noun>" button; `noun` is e.g. 'Cover' or 'Background'. */
export function imageUploadOverlay(noun: string): ComponentType<OverlayProps> {
  return function ImageUploadOverlay({ api }: OverlayProps) {
    const [image, setImage] = useState<string | null>(null);
    const [showUI, setShowUI] = useState(true);

    useEffect(() => {
      if (image) (api as ImageUploadApi | null)?.setImage(image);
    }, [api, image]);

    const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => setImage(event.target?.result as string);
      reader.readAsDataURL(file);
    };

    return (
      <div className="absolute bottom-6 right-6 flex items-center gap-3 z-20">
        {showUI && (
          <label className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-sm text-white cursor-pointer transition-colors">
            <ImagePlus className="w-4 h-4" />
            {image ? `Change ${noun}` : `Upload ${noun}`}
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </label>
        )}
        <button
          onClick={() => setShowUI(!showUI)}
          className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white transition-colors cursor-pointer"
          title={showUI ? 'Hide UI' : 'Show UI'}
        >
          {showUI ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    );
  };
}
