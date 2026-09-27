import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { visualizers } from '../../src/visualizers/registry';

describe('visualizer registry', () => {
  it('has unique ids and a module file for every entry', () => {
    const ids = visualizers.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of visualizers) {
      const base = `src/visualizers/impl/${v.module}`;
      expect(existsSync(`${base}.ts`) || existsSync(`${base}.tsx`), `${v.id} -> ${base}`).toBe(true);
    }
  });

  it('every module in impl/ is registered', () => {
    const modules = readdirSync('src/visualizers/impl').map(f => f.replace(/\.tsx?$/, ''));
    const registered = new Set<string>(visualizers.map(v => v.module));
    expect(modules.filter(m => !registered.has(m))).toEqual([]);
  });
});
