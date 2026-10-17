// VoltViz brand constants and helpers shared by the scripts that render images (OG image, promo).
import { existsSync, readFileSync } from 'node:fs';

export const BG = '#0f0f1a';
export const ACCENT = '#4ade80';
export const PURPLE = '#a855f7';
export const FONT_STACK =
  // Ubuntu Sans first: it is what this repo's WSL render box has; system-ui there is DejaVu
  '"Ubuntu Sans", "Segoe UI Variable Display", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

export function dataUri(path: string, mime: string): string {
  if (!existsSync(path)) throw new Error(`Missing image: ${path}`);
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}
