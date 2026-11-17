/**
 * The layering of src/, checked on the import statements, so a shortcut across layers fails the
 * build instead of slowly eroding the structure described in the README:
 *
 *   app  →  visualizers  →  audio (types only)        audio/core: pure DSP, imports nothing else
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = (readdirSync('src', { recursive: true }) as string[])
  .map(f => join('src', f).replace(/\\/g, '/'))
  .filter(f => /\.tsx?$/.test(f));

/** Every import of every source file: relative ones as a path from the repository root, packages by name. */
const imports = files.flatMap(file => {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => ({
    file,
    target: m[1].startsWith('.') ? normalize(join(dirname(file), m[1])).replace(/\\/g, '/') : m[1],
  }));
});

/** Imports from files under `from` whose target matches `forbidden`. */
const violations = (from: string, forbidden: (target: string, file: string) => boolean) =>
  imports.filter(i => i.file.startsWith(from) && forbidden(i.target, i.file)).map(i => `${i.file} → ${i.target}`);

describe('architecture', () => {
  it('finds the imports', () => {
    expect(imports.length).toBeGreaterThan(200);
  });

  it('audio/core is pure DSP: it imports only from audio/core', () => {
    expect(violations('src/audio/core/', target => !target.startsWith('src/audio/core/'))).toEqual([]);
  });

  it('the audio engine knows nothing about the app or the visualizers', () => {
    expect(violations('src/audio/', target => target.startsWith('src/app/') || target.startsWith('src/visualizers/'))).toEqual([]);
  });

  it('visualizers know nothing about the app, and of the audio engine only its types', () => {
    expect(violations('src/visualizers/', target => target.startsWith('src/app/'))).toEqual([]);
    expect(violations('src/visualizers/', (target, file) =>
      target.startsWith('src/audio/') && target !== 'src/audio/types'
      // the host drives the engine
      && !(file === 'src/visualizers/runtime/VisualizerHost.ts' && target === 'src/audio/AudioEngine'))).toEqual([]);
  });

  it('a visualizer does not import another visualizer', () => {
    expect(violations('src/visualizers/impl/', target => target.startsWith('src/visualizers/impl/'))).toEqual([]);
  });

  it('only the Sendspin source modules depend on the Sendspin SDK', () => {
    expect(violations('src/', (target, file) => target.startsWith('@sendspin/') && !file.startsWith('src/audio/sources/'))).toEqual([]);
  });

  it('the registry stays plain data', () => {
    expect(violations('src/visualizers/registry.ts', () => true)).toEqual([]);
  });
});
