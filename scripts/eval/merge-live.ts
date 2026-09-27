/**
 * Merge a re-run of some visualizers (e.g. longer measurement, or after a fix) into the main
 * live results, keeping the first run's verdict next to it so the report shows both.
 *
 *   node scripts/eval/merge-live.ts <main.json> <rerun.json> "<reason>"
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [mainPath, rerunPath, reason] = process.argv.slice(2);
const main = JSON.parse(readFileSync(mainPath, 'utf8'));
const rerun = JSON.parse(readFileSync(rerunPath, 'utf8'));
for (const r of rerun.results) {
  const i = main.results.findIndex((m: { id: string }) => m.id === r.id);
  const first = i >= 0 ? main.results[i] : null;
  const merged = {
    ...r,
    rerun: { reason, seconds: r.seconds, firstRun: first ? { pass: first.pass, why: first.why, seconds: first.seconds ?? main.seconds, lock: first.lock, r: first.coupling?.r, p: first.coupling?.p, firstRun: first.rerun?.firstRun } : null },
  };
  if (i >= 0) main.results[i] = merged; else main.results.push(merged);
}
writeFileSync(mainPath, JSON.stringify(main));
console.log(`merged ${rerun.results.length} re-run result(s) into ${mainPath}: ${main.results.filter((r: { pass: boolean }) => r.pass).length}/${main.results.length} pass`);
