/**
 * Scaffold a new visualizer.
 *
 *   npm run new:viz -- <id> "<Display Name>" [--template canvas2d|three|shader] [--beat]
 *
 * Creates src/visualizers/impl/<Module>.ts from scripts/templates/<template>.ts (keeping the
 * beat-reactive parts only with --beat) and appends the entry to src/visualizers/registry.ts.
 * The result compiles and runs as generated; see .github/skills/adding-visualizer/SKILL.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TEMPLATES = { canvas2d: 'TemplateCanvas2D', three: 'TemplateThree', shader: 'TemplateShader' } as const;
type Template = keyof typeof TEMPLATES;

function fail(msg: string): never {
  console.error(`new:viz: ${msg}`);
  console.error('usage: npm run new:viz -- <id> "<Display Name>" [--template canvas2d|three|shader] [--beat]');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--template');
const [id, name] = positional;
const template = (opt('template') ?? 'canvas2d') as Template;
const beat = flag('beat');

if (!id || !/^[a-z][a-z0-9]*$/.test(id)) fail('id must be lowercase letters/digits, starting with a letter (e.g. "starfield")');
if (!name) fail('missing display name');
if (!(template in TEMPLATES)) fail(`unknown template "${template}"`);
const moduleName = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
  .replace(/^[a-z]/, c => c.toUpperCase());
if (!/^[A-Z][A-Za-z0-9]*$/.test(moduleName)) fail(`cannot derive a module name from "${name}"`);

const registryPath = 'src/visualizers/registry.ts';
const registry = readFileSync(registryPath, 'utf8');
if (registry.includes(`id: '${id}'`)) fail(`id "${id}" already exists in ${registryPath}`);
if (registry.includes(`module: '${moduleName}'`)) fail(`module "${moduleName}" already exists in ${registryPath}`);
const target = `src/visualizers/impl/${moduleName}.ts`;
if (existsSync(target) || existsSync(`${target}x`)) fail(`${target} already exists`);

let src = readFileSync(`scripts/templates/${template}.ts`, 'utf8');
// keep or drop the beat-reactive parts
src = beat
  ? src.replace(/^[ \t]*\/\/ BEAT:(BEGIN|END)\n/gm, '').replace(/ \/\/ BEAT$/gm, '')
  : src.replace(/^[ \t]*\/\/ BEAT:BEGIN\n[\s\S]*?^[ \t]*\/\/ BEAT:END\n/gm, '').replace(/^.*\/\/ BEAT\n/gm, '');
// in the shader template the beat uniform stays declared (0) without --beat
src = src
  .replaceAll(TEMPLATES[template], moduleName)
  .replaceAll('__NAME__', name)
  .replaceAll("'../../src/visualizers/", "'../");
if (!beat) src = src.replace(/let (\w+) = settings\.scale/g, 'const $1 = settings.scale');
writeFileSync(target, src);

const marker = '] as const satisfies readonly VisualizerEntry[];';
if (!registry.includes(marker)) fail(`could not find the end of the visualizer list in ${registryPath}`);
const entry = `  { id: '${id}', name: '${name.replace(/'/g, "\\'")}', module: '${moduleName}' },\n`;
writeFileSync(registryPath, registry.replace(marker, `${entry}${marker}`));

console.log(`Created ${target} (${template}${beat ? ', beat-reactive' : ''}) and registered "${id}".

Next steps (see .github/skills/adding-visualizer/SKILL.md):
  1. npm run dev  ->  http://localhost:3000/?viz=${id}  (start an audio source)
  2. make it yours; keep the frame() contract and dispose everything you create
  3. npm run lint && npm run test:unit
  4. npm run eval:live -- --ids ${id}      (beat response + health must PASS)
  5. npm run capture:previews -- ${id}     (picker thumbnail)
  6. add a line to CHANGELOG.md under [Unreleased]`);
