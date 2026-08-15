#!/usr/bin/env node
/**
 * Build taskpack.org from the sources that are already the truth.
 *
 * The spec page is GENERATED from docs/taskpack-0.1.md and the extension descriptor is
 * COPIED from docs/a2a-extension.json. Neither is retyped here. A website that keeps its
 * own copy of the spec drifts from it, and then the canonical URL is quietly lying —
 * which is a worse failure than having no website.
 *
 * Zero dependencies: the renderer below handles exactly the markdown this spec uses and
 * refuses to grow into a general one.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const out = join(here, 'dist')

const escape = (text) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Inline: code first, so nothing inside backticks gets re-interpreted. */
function inline(text) {
  const codes = []
  let value = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escape(code)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  value = escape(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
  return value.replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)])
}

function render(markdown) {
  const lines = markdown.split(/\r?\n/)
  const html = []
  let index = 0

  const paragraph = []
  const flush = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph.length = 0
    }
  }

  while (index < lines.length) {
    const line = lines[index]

    if (line.startsWith('```')) {
      flush()
      const body = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) body.push(lines[index++])
      index += 1
      html.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flush()
      const level = heading[1].length
      const id = heading[2].toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-|-$/g, '')
      html.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    // Tables: a header row followed by a separator row of dashes.
    if (line.includes('|') && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[index + 1] || '')) {
      flush()
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      const head = cells(line)
      index += 2
      const rows = []
      while (index < lines.length && lines[index].includes('|')) rows.push(cells(lines[index++]))
      html.push(
        `<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>` +
        rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table>',
      )
      continue
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flush()
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items = []
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*([-*]|\d+\.)\s+/, ''))
        index += 1
        // Continuation lines belong to the item above them.
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !/^\s*([-*]|\d+\.)\s/.test(lines[index])) {
          items[items.length - 1] += ` ${lines[index++].trim()}`
        }
      }
      const tag = ordered ? 'ol' : 'ul'
      html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`)
      continue
    }

    if (line.startsWith('> ')) {
      flush()
      const quote = []
      while (index < lines.length && lines[index].startsWith('>')) {
        quote.push(lines[index++].replace(/^>\s?/, ''))
      }
      html.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`)
      continue
    }

    if (!line.trim()) {
      flush()
      index += 1
      continue
    }
    if (/^---+$/.test(line.trim())) {
      flush()
      html.push('<hr>')
      index += 1
      continue
    }

    paragraph.push(line.trim())
    index += 1
  }
  flush()
  return html.join('\n')
}

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="alternate" type="text/markdown" href="../0.1.md">
<style>
:root{--bg:#fbfaf8;--fg:#1a1917;--dim:#6b6862;--line:#e2ded7;--accent:#8a5a2b;--code-bg:#f3f0ea}
@media (prefers-color-scheme:dark){:root{--bg:#14140f;--fg:#e8e5df;--dim:#9a968d;--line:#2c2b26;--accent:#d9a066;--code-bg:#1e1d18}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans SC","PingFang SC",sans-serif}
main{max-width:46rem;margin:0 auto;padding:3.5rem 1.5rem 6rem}
h1{font-size:2.1rem;letter-spacing:-.02em;margin:0 0 1.5rem}
h2{font-size:1.15rem;margin:2.8rem 0 .7rem;padding-top:1.3rem;border-top:1px solid var(--line)}
h3{font-size:1rem;margin:1.7rem 0 .4rem}
a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 35%,transparent)}
a:hover{border-bottom-color:var(--accent)}
code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
code{background:var(--code-bg);padding:.12em .38em;border-radius:4px;font-size:.9em}
pre{background:var(--code-bg);padding:1rem;border-radius:8px;overflow-x:auto;font-size:.84rem;line-height:1.6;border:1px solid var(--line)}
pre code{background:none;padding:0}
table{width:100%;border-collapse:collapse;margin:1.2rem 0;font-size:.92rem}
th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--dim);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
blockquote{margin:1.4rem 0;padding:.1rem 0 .1rem 1.1rem;border-left:3px solid var(--accent);color:var(--fg)}
hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
li{margin:.3rem 0}
nav{font-size:.85rem;color:var(--dim);margin-bottom:2.5rem}
</style>
</head>
<body><main>
<nav><a href="../../">taskpack.org</a> · <a href="../0.1.md">raw markdown</a> · <a href="../../a2a/ext/taskpack/v1">A2A extension</a> · <a href="https://github.com/dongsheng123132/task-passport">reference implementation</a></nav>
${body}
</main></body>
</html>
`

await mkdir(join(out, 'spec', '0.1'), { recursive: true })
await mkdir(join(out, 'a2a', 'ext', 'taskpack'), { recursive: true })

const spec = await readFile(join(repo, 'docs', 'taskpack-0.1.md'), 'utf8')
await writeFile(join(out, 'spec', '0.1', 'index.html'), page('TaskPack 0.1 — Specification', render(spec)))
await writeFile(join(out, 'spec', '0.1.md'), spec)

// The extension URI has no file extension, so Pages needs _headers to type it correctly.
await copyFile(join(repo, 'docs', 'a2a-extension.json'), join(out, 'a2a', 'ext', 'taskpack', 'v1'))
await copyFile(join(here, 'index.html'), join(out, 'index.html'))

await writeFile(join(out, '_headers'), `/a2a/ext/taskpack/v1
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600

/spec/0.1.md
  Content-Type: text/markdown; charset=utf-8
  Access-Control-Allow-Origin: *
`)

// GitHub Pages drops the custom domain on deploy unless the artifact carries it, and a
// dropped domain turns every URL the A2A descriptor claims back into a 404.
await writeFile(join(out, 'CNAME'), `taskpack.org${String.fromCharCode(10)}`)

await writeFile(join(out, '_redirects'), `/spec            /spec/0.1   302
/spec/latest     /spec/0.1   302
/a2a             /a2a/ext/taskpack/v1   302
`)

// A link in the descriptor that 404s makes the whole extension look invented, so the
// build refuses to finish until every self-referential URL has a file behind it.
const descriptor = JSON.parse(await readFile(join(repo, 'docs', 'a2a-extension.json'), 'utf8'))
const mustExist = { '/spec/0.1': 'spec/0.1/index.html', '/a2a/ext/taskpack/v1': 'a2a/ext/taskpack/v1' }
const missing = []
for (const url of [descriptor.uri, descriptor.specification]) {
  const path = new URL(url).pathname
  if (!mustExist[path]) missing.push(`${url} is claimed by the descriptor but the build does not produce it`)
}
if (missing.length) {
  console.error(missing.join('\n'))
  process.exit(1)
}

console.log(JSON.stringify({
  ok: true,
  out,
  pages: ['/', '/spec/0.1', '/spec/0.1.md', '/a2a/ext/taskpack/v1'],
  spec_bytes: spec.length,
}))
