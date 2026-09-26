#!/usr/bin/env node
// Zero-dependency bundler: native ES modules (src/main.js graph) -> ONE self-contained
// dist/index.html (inline CSS + inline script). Works from file:// and any static host.
// Supported syntax (enforced by tests/architecture.test.js): static named imports at the top of
// the file, `import * as NS`, `export function/class/const`, `export { a, b as c }`,
// `export { a } from './x.js'`. No default exports, no dynamic import(), no cycles.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const entry = join(root, 'src', 'main.js');
const outDir = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const modules = new Map(); // abs path -> { id, deps, code, exports }
const order = [];

function parseSpecifiers(list) {
  // "a, b as c" -> [['a','a'], ['b','c']]  (imported, local)
  return list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(s);
    if (!m) throw new Error('Unsupported specifier: ' + s);
    return [m[1], m[2] || m[1]];
  });
}

function load(file) {
  if (modules.has(file)) return modules.get(file);
  const src = readFileSync(file, 'utf8');
  const mod = { id: modules.size, file, deps: [], header: [], body: [], exports: [] };
  modules.set(file, mod);
  const lines = src.split('\n');
  let i = 0;
  const depVar = (spec) => {
    const abs = resolve(dirname(file), spec);
    const dep = load(abs);
    if (mod.deps.indexOf(dep) < 0) mod.deps.push(dep);
    return '__m' + dep.id;
  };
  while (i < lines.length) {
    let line = lines[i];
    const trimmed = line.trim();
    // gather multi-line import / re-export statements
    if (/^(import|export)\s*[{*]/.test(trimmed) || /^import\s+\w/.test(trimmed)) {
      let stmt = trimmed;
      while (!/from\s+['"][^'"]+['"]\s*;?\s*$/.test(stmt) && !/^import\s+['"]/.test(stmt) && i + 1 < lines.length && /^(import|export)\s*[{*]|^import\s+\w/.test(trimmed)) {
        if (/^export\s*\{[^}]*\}\s*;?\s*$/.test(stmt)) break; // local export list (no "from")
        i++;
        stmt += ' ' + lines[i].trim();
      }
      let m;
      if ((m = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?$/.exec(stmt))) {
        const v = depVar(m[2]);
        const specs = parseSpecifiers(m[1]).map(([a, b]) => (a === b ? a : `${a}: ${b}`)).join(', ');
        mod.header.push(`const { ${specs} } = ${v};`);
        i++; continue;
      }
      if ((m = /^import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?$/.exec(stmt))) {
        mod.header.push(`const ${m[1]} = ${depVar(m[2])};`);
        i++; continue;
      }
      if ((m = /^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?$/.exec(stmt))) {
        const v = depVar(m[2]);
        for (const [a, b] of parseSpecifiers(m[1])) mod.exports.push([b, `${v}.${a}`]);
        i++; continue;
      }
      if ((m = /^export\s*\{([^}]*)\}\s*;?$/.exec(stmt))) {
        for (const [a, b] of parseSpecifiers(m[1])) mod.exports.push([b, a]);
        i++; continue;
      }
      if (/^import\s/.test(stmt)) throw new Error(`${relative(root, file)}: unsupported import: ${stmt}`);
    }
    let m;
    if ((m = /^export\s+(async\s+)?function\s*\*?\s*(\w+)/.exec(line))) {
      mod.exports.push([m[2], m[2]]);
      line = line.replace(/^export\s+/, '');
    } else if ((m = /^export\s+class\s+(\w+)/.exec(line))) {
      mod.exports.push([m[1], m[1]]);
      line = line.replace(/^export\s+/, '');
    } else if ((m = /^export\s+const\s+(\w+)/.exec(line))) {
      mod.exports.push([m[1], m[1]]);
      line = line.replace(/^export\s+/, '');
    } else if (/^export\s+(let|var|default)\b/.test(line)) {
      throw new Error(`${relative(root, file)}: unsupported export: ${line.trim()}`);
    } else if (/\bimport\s*\(/.test(line) || /\bimport\.meta\b/.test(line)) {
      throw new Error(`${relative(root, file)}: dynamic import / import.meta not supported`);
    }
    mod.body.push(line);
    i++;
  }
  order.push(mod); // post-order: dependencies first
  return mod;
}

load(entry);

let js = `/* ${pkg.name} v${pkg.version} — single-file build. Unofficial fan project inspired by Trench Crusade. */\n`;
js += '(function () {\n\'use strict\';\n';
for (const mod of order) {
  js += `// ---- ${relative(root, mod.file).split('\\').join('/')}\n`;
  js += `const __m${mod.id} = (function () {\n`;
  if (mod.header.length) js += mod.header.join('\n') + '\n';
  js += mod.body.join('\n') + '\n';
  js += `return Object.freeze({ ${mod.exports.map(([n, v]) => (n === v ? n : `${n}: ${v}`)).join(', ')} });\n})();\n`;
}
js += '})();\n';

// sanity: no leftover module syntax
if (/^\s*import\s[^(]/m.test(js)) throw new Error('leftover import statement in bundle');
if (/^\s*export\s/m.test(js)) throw new Error('leftover export statement in bundle');

const css = readFileSync(join(root, 'src', 'ui', 'style.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8')
  .replace(/<link rel="stylesheet" href="src\/ui\/style.css">/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="src\/main.js"><\/script>/, () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
if (html.includes('<script type="module" src="src/main.js">') || html.includes('href="src/ui/style.css"')) throw new Error('index.html placeholders not found');

mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'index.html');
writeFileSync(out, html);
const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`built ${relative(root, out)} — ${order.length} modules, ${kb} KB`);

// Body-fragment variant for hosts that supply their own <!doctype>/<head>/<body> skeleton
// (title + style first, then the app root and the script).
const title = (/<title>([^<]*)<\/title>/.exec(html) || [0, 'Yeni Antakya Kuşatması'])[1];
const fragment = `<title>${title}</title>\n<style>\n${css}\n</style>\n<div id="app"></div>\n` +
  `<noscript>Bu oyun JavaScript gerektirir. / This game requires JavaScript.</noscript>\n` +
  `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>\n`;
const outFrag = join(outDir, 'artifact.html');
writeFileSync(outFrag, fragment);
console.log(`built ${relative(root, outFrag)} (embeddable fragment) — ${(statSync(outFrag).size / 1024).toFixed(0)} KB`);
