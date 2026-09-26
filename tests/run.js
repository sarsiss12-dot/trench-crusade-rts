#!/usr/bin/env node
// Test runner: node tests/run.js [filter]
// Runs every tests/*.test.js (sequentially) and exits non-zero on failure.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registry, currentFile } from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(here).filter((f) => f.endsWith('.test.js')).sort();

const t0 = Date.now();
for (const f of files) {
  currentFile.name = f.replace('.test.js', '');
  await import(pathToFileURL(join(here, f)).href);
}

let pass = 0, fail = 0;
const failures = [];
let lastFile = '';
for (const t of registry) {
  if (filter && !(t.file.includes(filter) || t.name.includes(filter))) continue;
  if (t.file !== lastFile) {
    console.log('\n[' + t.file + ']');
    lastFile = t.file;
  }
  const ts = Date.now();
  try {
    await t.fn();
    pass++;
    console.log('  ok   ' + t.name + ' (' + (Date.now() - ts) + 'ms)');
  } catch (e) {
    fail++;
    failures.push({ t, e });
    console.log('  FAIL ' + t.name);
    console.log('       ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n       '));
  }
}
console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (fail) process.exit(1);
