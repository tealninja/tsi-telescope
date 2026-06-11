#!/usr/bin/env node
/* ============================================================
   Concatenate the ES modules under src/ into a single inline
   <script> block, drop the inline <style> back into the head,
   and emit dist/standalone.html — one self-contained file that
   can be opened by double-click or emailed to a colleague.

   Strategy:
     1. Resolve modules in dependency order (topological by import).
     2. Strip each module's import/export statements; the resulting
        script runs as one big classic-script block.
     3. Read index.html, replace the <link rel="stylesheet"> with
        an inline <style> and the <script type="module" src="..."> with
        the concatenated script body.

   Run: node build.js
   ============================================================ */

const fs   = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const SRC  = path.join(ROOT, 'src');
const CSS  = path.join(ROOT, 'styles/tsi.css');
const HTML = path.join(ROOT, 'index.html');
const OUT  = path.join(ROOT, 'dist/standalone.html');

// Topological resolve: walk import graph from boot.js.
function collectModules(entry) {
  const order = [];
  const seen  = new Set();
  function visit(absPath) {
    if (seen.has(absPath)) return;
    seen.add(absPath);
    const src = fs.readFileSync(absPath, 'utf8');
    const importRe = /^\s*import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"];?/gm;
    let m;
    while ((m = importRe.exec(src)) !== null) {
      const dep = path.resolve(path.dirname(absPath), m[1]);
      visit(dep);
    }
    order.push(absPath);
  }
  visit(entry);
  return order;
}

function stripModuleSyntax(src) {
  // Remove `import ... from '...';` (single or multi-line).
  src = src.replace(/^\s*import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
  // Replace `export [async] function/const/let/var/class X` with the bare declaration.
  src = src.replace(/^export\s+(async\s+function|function|const|let|var|class)\b/gm, '$1');
  // Replace `export { ... };` lines (none in this codebase, but cheap insurance).
  src = src.replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
  return src;
}

const modules = collectModules(path.join(SRC, 'boot.js'));
const scriptBody = modules
  .map(p => `/* ===== ${path.relative(ROOT, p)} ===== */\n${stripModuleSyntax(fs.readFileSync(p, 'utf8'))}`)
  .join('\n\n');

const css  = fs.readFileSync(CSS, 'utf8');
let html   = fs.readFileSync(HTML, 'utf8');

// Use the function form of replace so '$$' inside our payload isn't
// interpreted as the special replacement token.
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="styles\/tsi\.css"\s*\/?>/,
  () => `<style>\n${css}\n</style>`
);
html = html.replace(
  /<script\s+type="module"\s+src="src\/boot\.js"\s*><\/script>/,
  () => `<script>\n${scriptBody}\n</script>`
);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(ROOT, OUT)}  (${html.length.toLocaleString()} bytes, ${modules.length} modules)`);
