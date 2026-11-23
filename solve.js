// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Written from scratch from the kit's README + reference behaviour: same answers
// byte for byte, much less CPU. No dependencies, no network, no clock.
//
// Speed ideas: index-based inline Markdown (no per-character escapeHtml calls,
// no token arrays, pending-run slicing), direct block rendering, cached slugify /
// longDate, one-pass front matter without splitting the whole body, and an
// array-accumulator template renderer. Semantics follow the reference exactly.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const REPORT_FILE = 'build-report.txt';
const RESERVED = Object.freeze(['posts', 'tags', 'page']);

// ---------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** escapeHtml, but built by scanning for the first special char first. */
export function escapeHtml(text) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) break;
    i++;
  }
  if (i === n) return text;
  const out = [];
  let start = 0;
  for (let j = i; j < n; j++) {
    const c = text.charCodeAt(j);
    let e = null;
    if (c === 38) e = '&amp;';
    else if (c === 60) e = '&lt;';
    else if (c === 62) e = '&gt;';
    else if (c === 34) e = '&quot;';
    else if (c === 39) e = '&#39;';
    if (e !== null) {
      if (j > start) out.push(text.slice(start, j));
      out.push(e);
      start = j + 1;
    }
  }
  if (n > start) out.push(text.slice(start, n));
  return out.join('');
}

/** escapeHtml of text[lo..hi) pushed into out (no intermediate string). */
function escInto(text, lo, hi, out) {
  let start = lo;
  for (let j = lo; j < hi; j++) {
    const c = text.charCodeAt(j);
    let e = null;
    if (c === 38) e = '&amp;';
    else if (c === 60) e = '&lt;';
    else if (c === 62) e = '&gt;';
    else if (c === 34) e = '&quot;';
    else if (c === 39) e = '&#39;';
    if (e !== null) {
      if (j > start) out.push(text.slice(start, j));
      out.push(e);
      start = j + 1;
    }
  }
  if (hi > start) out.push(text.slice(start, hi));
}

const SLUG_MAX = 64;
const slugCache = new Map();

function slugifySlow(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

/** Slug, cached; pure-ASCII inputs take a fast path (NFKD is identity there). */
export function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  let out;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 128) { ascii = false; break; }
  }
  if (ascii) {
    let s = '';
    let gap = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      let keep = -1;
      if (c >= 65 && c <= 90) keep = c + 32;
      else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
      if (keep === -1) {
        gap = s.length > 0;
        continue;
      }
      if (gap) s += '-';
      gap = false;
      s += String.fromCharCode(keep);
    }
    if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX);
    let end = s.length;
    while (end > 0 && s.charCodeAt(end - 1) === 45) end--;
    s = s.slice(0, end);
    out = s === '' ? 'untitled' : s;
  } else {
    out = slugifySlow(text);
  }
  if (slugCache.size < 20000) slugCache.set(text, out);
  return out;
}

export function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateCache = new Map();
export function longDate(date) {
  let v = dateCache.get(date);
  if (v === undefined) {
    const y = date.slice(0, 4);
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    v = `${d} ${MONTHS[m - 1]} ${y}`;
    if (dateCache.size < 5000) dateCache.set(date, v);
  }
  return v;
}

/** Words: runs of non-whitespace code units, matching /\S+/g exactly. */
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const sp =
      c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 160 ||
      c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
      c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    if (sp) inWord = false;
    else if (!inWord) { inWord = true; n++; }
  }
  return n;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG_RE.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/** Parse front matter by scanning line offsets: no split/join of the body. */
export function parseFrontMatter(text) {
  if (text !== '---' && !text.startsWith('---\n')) return { error: 'no front matter' };
  // Find the closing '---' line first (its absence beats any line error).
  let closeStart = -1;
  let closeEnd = -1; // index of the '\n' ending the close line, or text.length
  let ls = 4;
  let idx = 1;
  let closeIdx = -1;
  while (ls <= text.length) {
    const le = text.indexOf('\n', ls);
    const lineEnd = le === -1 ? text.length : le;
    const line = text.slice(ls, lineEnd);
    if (line === '---') { closeStart = ls; closeEnd = lineEnd; closeIdx = idx; break; }
    if (le === -1) break;
    ls = le + 1;
    idx++;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  ls = 4;
  idx = 1;
  while (ls < closeStart) {
    const le = text.indexOf('\n', ls);
    const lineEnd = le === -1 ? text.length : le;
    const line = text.slice(ls, lineEnd);
    const n = idx + 1;
    let blank = true;
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      if (c !== 32 && c !== 9) { blank = false; break; }
    }
    if (!blank && line.charCodeAt(0) !== 35) {
      const colon = line.indexOf(':');
      let key = null;
      let raw = null;
      if (colon > 0) {
        key = line.slice(0, colon);
        let okKey = true;
        for (let i = 0; i < key.length; i++) {
          const c = key.charCodeAt(i);
          if (!((c >= 97 && c <= 122) || c === 95)) { okKey = false; break; }
        }
        if (okKey) {
          const rest = line.slice(colon + 1);
          if (rest === '') raw = '';
          else if (rest.charCodeAt(0) === 32) raw = rest.slice(1);
        }
      }
      if (key === null || raw === null) return { error: `line ${n} is not "key: value"` };
      // drop trailing spaces/tabs from raw
      let re = raw.length;
      while (re > 0) {
        const c = raw.charCodeAt(re - 1);
        if (c !== 32 && c !== 9) break;
        re--;
      }
      raw = raw.slice(0, re);
      if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    if (le === -1 || le >= closeStart) break;
    ls = le + 1;
    idx++;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = closeEnd === text.length ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

// ---------------------------------------------------------------- markdown

// Characters a backslash escapes: \ ` * _ [ ] ( ) # + - . ! >
const ESCAPABLE_ARR = new Uint8Array(128);
for (const c of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) ESCAPABLE_ARR[c.charCodeAt(0)] = 1;

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c !== 32 && c !== 9) break;
    a++;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c !== 32 && c !== 9) break;
    b--;
  }
  return line.slice(a, b);
}

/** Fence open: language or '' ; null when not a fence. */
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) { i++; continue; }
    break;
  }
  const lang = line.slice(3, i);
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
    i++;
  }
  return lang;
}

function fenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Heading: {depth, text} or null. */
function headingOf(line) {
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === 35) n++;
  if (n === 0 || n > 6) return null;
  if (n >= line.length) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  let i = n;
  while (i < line.length) {
    const d = line.charCodeAt(i);
    if (d !== 32 && d !== 9) break;
    i++;
  }
  let end = line.length;
  while (end > i) {
    const d = line.charCodeAt(end - 1);
    if (d !== 32 && d !== 9) break;
    end--;
  }
  if (end === i) return null;
  return { depth: n, text: line.slice(i, end) };
}

function isHR(line) {
  const dash = line.startsWith('---');
  const star = !dash && line.startsWith('***');
  if (!dash && !star) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function endsParagraph(line) {
  return isBlank(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHR(line);
}

function bulletCap(line) {
  const c = line.charCodeAt(0);
  if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

function orderedCap(line) {
  let j = 0;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if (c < 48 || c > 57) break;
    j++;
  }
  if (j === 0 || j > 9) return null;
  if (line.charCodeAt(j) !== 46 || line.charCodeAt(j + 1) !== 32) return null;
  return { num: line.slice(0, j), text: line.slice(j + 2) };
}

/** /^ {2,}\S/ : two or more spaces, then a non-whitespace char. */
function isContinued(line) {
  let j = 0;
  while (j < line.length && line.charCodeAt(j) === 32) j++;
  if (j < 2 || j >= line.length) return false;
  return !/\s/.test(line[j]);
}

function findUnescaped(s, what, from, hi) {
  const wlen = what.length;
  for (let j = from; j <= hi - wlen; j++) {
    if (s.charCodeAt(j) === 92 && j + 1 < hi && ESCAPABLE_ARR[s.charCodeAt(j + 1)] === 1) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from, hi) {
  for (let j = from; j < hi; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < hi && ESCAPABLE_ARR[s.charCodeAt(j + 1)] === 1) {
      j++;
      continue;
    }
    if (c !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

// The characters that can start an inline construct or need escaping, as a
// regex class source (built programmatically so no character is mistyped).
const INLINE_CLASS_SRC =
  '[' +
  ['\\', '`', '*', '[', '&', '<', '>', '"', "'"].map((c) => c.replace(/[[\\\]]/g, '\\$&')).join('') +
  ']';

/** Render s[lo..hi) inline into out, scanning for the next interesting
 *  character with a regex instead of stepping through every character. */
function inlineTo(s, lo, hi, env, out) {
  const re = new RegExp(INLINE_CLASS_SRC, 'g');
  let p = lo;
  re.lastIndex = lo;
  for (;;) {
    const m = re.exec(s);
    if (m === null || m.index >= hi) break;
    const i = m.index;
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < hi && ESCAPABLE_ARR[s.charCodeAt(i + 1)] === 1) {
        if (i > p) out.push(s.slice(p, i));
        // The reference escapes the escaped character too; '>' is the one
        // escapable character that is also HTML-special.
        out.push(s[i + 1] === '>' ? '&gt;' : s[i + 1]);
        p = i + 2;
        re.lastIndex = i + 2;
      } else {
        re.lastIndex = i + 1;
      }
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j !== -1 && j < hi && j > i + 1) {
        if (i > p) out.push(s.slice(p, i));
        out.push('<code>');
        escInto(s, i + 1, j, out);
        out.push('</code>');
        p = j + 1;
        re.lastIndex = j + 1;
      } else {
        re.lastIndex = i + 1;
      }
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2, hi);
        if (j !== -1 && j > i + 2) {
          if (i > p) out.push(s.slice(p, i));
          out.push('<strong>');
          inlineTo(s, i + 2, j, env, out);
          out.push('</strong>');
          p = j + 2;
          re.lastIndex = j + 2;
        } else {
          re.lastIndex = i + 2;
        }
      } else {
        const j = findSingleStar(s, i + 1, hi);
        if (j !== -1 && j > i + 1) {
          if (i > p) out.push(s.slice(p, i));
          out.push('<em>');
          inlineTo(s, i + 1, j, env, out);
          out.push('</em>');
          p = j + 1;
          re.lastIndex = j + 1;
        } else {
          re.lastIndex = i + 1;
        }
      }
      continue;
    }
    if (c === 91) {
      const k = findUnescaped(s, ']', i + 1, hi);
      let mm = -1;
      if (k !== -1 && s.charCodeAt(k + 1) === 40) {
        mm = s.indexOf(')', k + 2);
        if (mm >= hi) mm = -1;
      }
      if (mm !== -1) {
        const target = s.slice(k + 2, mm);
        if (target !== '' && !/\s/.test(target)) {
          if (i > p) out.push(s.slice(p, i));
          out.push('<a href="');
          out.push(escapeHtml(env.link(target)));
          out.push('">');
          inlineTo(s, i + 1, k, env, out);
          out.push('</a>');
          p = mm + 1;
          re.lastIndex = mm + 1;
          continue;
        }
      }
      re.lastIndex = i + 1;
      continue;
    }
    if (i > p) out.push(s.slice(p, i));
    out.push(c === 38 ? '&amp;' : c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 34 ? '&quot;' : '&#39;');
    p = i + 1;
    re.lastIndex = i + 1;
  }
  if (hi > p) out.push(s.slice(p, hi));
}

function inlineStr(s, env) {
  const out = [];
  inlineTo(s, 0, s.length, env, out);
  return out.join('');
}

export function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const n = lines.length;
  const blocks = [];
  const toc = [];
  const ids = new Set();
  let excerpt = null;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const fence = fenceOpen(line);
    if (fence !== null) {
      const body = [];
      i++;
      while (i < n && !fenceClose(lines[i])) body.push(lines[i++]);
      i++;
      const parts = ['<pre><code'];
      if (fence !== '') { parts.push(' class="language-'); parts.push(escapeHtml(fence)); parts.push('"'); }
      parts.push('>');
      for (let k = 0; k < body.length; k++) {
        parts.push(escapeHtml(body[k]));
        parts.push('\n');
      }
      parts.push('</code></pre>\n');
      blocks.push(parts.join(''));
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text), ids);
      const html = inlineStr(heading.text, env);
      blocks.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>\n`);
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if (isHR(line)) {
      blocks.push('<hr>\n');
      i++;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i].slice(1);
        if (l.charCodeAt(0) === 32) l = l.slice(1);
        body.push(l);
        i++;
      }
      const kept = [];
      for (let k = 0; k < body.length; k++) {
        const t = trimLine(body[k]);
        if (t !== '') kept.push(t);
      }
      if (kept.length === 0) blocks.push('<blockquote>\n</blockquote>\n');
      else blocks.push(`<blockquote>\n<p>${inlineStr(kept.join('\n'), env)}</p>\n</blockquote>\n`);
      continue;
    }
    const bCap = bulletCap(line);
    const oCap = bCap === null ? orderedCap(line) : null;
    if (bCap !== null || oCap !== null) {
      const isOrdered = oCap !== null;
      const items = [];
      while (i < n) {
        const l = lines[i];
        const cap = isOrdered ? orderedCap(l) : bulletCap(l);
        if (cap !== null) {
          items.push([trimLine(isOrdered ? cap.text : cap)]);
          i++;
        } else if (isContinued(l)) {
          items[items.length - 1].push(trimLine(l));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && Number(oCap.num) !== 1 ? `<ol start="${Number(oCap.num)}">` : `<${tag}>`;
      const parts = [open, '\n'];
      for (let k = 0; k < items.length; k++) {
        parts.push('<li>');
        parts.push(inlineStr(items[k].join('\n'), env));
        parts.push('</li>\n');
      }
      parts.push(`</${tag}>\n`);
      blocks.push(parts.join(''));
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inlineStr(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>\n`);
  }
  return { html: blocks.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

export class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

export function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookupFirst(scope, name) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, name)) s = s.parent;
  return s === null ? undefined : s.vars[name];
}

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function renderNodes(nodes, scope, ctx, depth, out) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    switch (n.kind) {
      case 'text':
        out.push(n.text);
        break;
      case 'var':
        out.push(escapeHtml(textOf(lookup(scope, n.path))));
        break;
      case 'raw':
        out.push(textOf(lookup(scope, n.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, out);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const len = xs.length;
        for (let k = 0; k < len; k++) {
          const vars = { [n.name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === len - 1, length: len } };
          renderNodes(n.body, { vars, parent: scope }, ctx, depth, out);
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t === undefined || depth >= 8) break;
        const m = ctx.meta.get(n.name);
        if (m === undefined || !m.cacheable) {
          renderNodes(t, scope, ctx, depth + 1, out);
          break;
        }
        // Cached: a template's output is a pure function of its free variables
        // (resolved in the caller's scope) and the include depth.
        const levels = [depth];
        for (let fi = 0; fi < m.free.length; fi++) levels.push(lookupFirst(scope, m.free[fi]));
        let cur = m.root;
        for (let li = 0; li < levels.length - 1; li++) {
          let nx = cur.get(levels[li]);
          if (nx === undefined) { nx = new Map(); cur.set(levels[li], nx); }
          cur = nx;
        }
        const last = levels[levels.length - 1];
        let hit = cur.get(last);
        if (hit === undefined) {
          const tmp = [];
          renderNodes(t, scope, ctx, depth + 1, tmp);
          hit = tmp.join('');
          cur.set(last, hit);
        }
        out.push(hit);
        break;
      }
    }
  }
}

/**
 * Each template's free variables: first-segment names it reads that no
 * enclosing for of its own binds, including through includes (fixpoint).
 * A template is cacheable when none of its free variables is one the
 * layouts rebuild on every render (page, tag, pager, posts); the rest
 * (site, tags, recent, and loop-bound values such as a post's card) keep
 * their identity across renders, so a cached include is exact.
 */
const VOLATILE_VARS = new Set(['page', 'tag', 'pager', 'posts']);

function collectFree(nodes, bound, templates, free, out) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    switch (n.kind) {
      case 'var':
      case 'raw':
        if (!bound.has(n.path[0])) out.add(n.path[0]);
        break;
      case 'if':
        if (!bound.has(n.path[0])) out.add(n.path[0]);
        collectFree(n.then, bound, templates, free, out);
        if (n.else !== null) collectFree(n.else, bound, templates, free, out);
        break;
      case 'for': {
        if (!bound.has(n.path[0])) out.add(n.path[0]);
        const b2 = new Set(bound);
        b2.add(n.name);
        b2.add('loop');
        collectFree(n.body, b2, templates, free, out);
        break;
      }
      case 'include': {
        const sub = free.get(n.name);
        if (sub !== undefined) {
          for (const v of sub) if (!bound.has(v)) out.add(v);
        }
        break;
      }
    }
  }
}

function templateMeta(templates) {
  const free = new Map();
  for (const name of templates.keys()) free.set(name, new Set());
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, nodes] of templates) {
      const s = free.get(name);
      const before = s.size;
      collectFree(nodes, new Set(), templates, free, s);
      if (s.size !== before) changed = true;
    }
  }
  const meta = new Map();
  for (const [name, s] of free) {
    let cacheable = true;
    for (const v of s) if (VOLATILE_VARS.has(v)) { cacheable = false; break; }
    meta.set(name, { free: [...s], cacheable, root: new Map() });
  }
  return meta;
}

// ---------------------------------------------------------------- build

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function build(input) {
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report,
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };

  // 1. sources, sorted by path; .md sources have \r\n / \r made \n
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else b.statics.push({ path: f.path, content: f.content });
  }

  // 2. front matter, in the reference's check order
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;

  // 3. permalinks
  const taken = new Map();
  const takenIn = (dir) => {
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    return taken.get(dir);
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }

  // 4. markdown
  const staticPaths = new Set(b.statics.map((f) => f.path));
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (SCHEME_RE.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && b.bySource.has(path)) return `${b.bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${b.base}/${path}${frag}`;
        b.broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. collections
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const sl = slugify(name);
      if (!seen.has(sl)) { seen.add(sl); out.push(name); }
    }
    return out;
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) {
    if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  }
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. layouts
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  for (const s of b.sources) s.card = cardOf(s);
  b.cards = new Map(b.posts.map((p) => [p, p.card]));
  const site = { title: input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, input.site.recent).map((p) => p.card);
  const ctx = { templates: b.templates, escape: escapeHtml, meta: templateMeta(b.templates) };
  const render = (name, vars) => {
    const nodes = b.templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    renderNodes(nodes, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0, out);
    return out.join('');
  };
  const tagOf = (t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) });
  for (const s of b.sources) {
    const page = {
      ...s.card,
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    b.output[`${s.outDir}/index.html`] = render(s.layout, { page });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    const html = render('tag', { tag: tagOf(t) });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }

  // 8. report
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  const pagesCount = b.sources.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return b.output;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  return build(input);
}
