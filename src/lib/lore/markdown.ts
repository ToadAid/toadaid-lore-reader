/**
 * Focused Markdown presentation for canonical lore strings.
 *
 * Renders a narrow, archival subset of Markdown into semantic HTML:
 * headings, paragraphs, blockquotes, unordered lists (one level of nesting),
 * bold, italics, inline code, safe markdown links, bare-URL autolinks and
 * horizontal rules.
 *
 * Contract guarantees:
 * - The canonical source string is never mutated. This module only reads it.
 * - All text is HTML-escaped. Arbitrary HTML in canonical content is never
 *   executed or trusted; it renders as visible escaped text.
 * - Links are only emitted for http/https/mailto schemes. Everything else
 *   falls back to escaped plain text.
 * - Malformed input fails safe: unrecognised markers render as escaped text.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

const SAFE_URL = /^(https?:|mailto:)/i;

function isSafeUrl(url: string): boolean {
  return SAFE_URL.test(url) && !/[\u0000-\u001f<>"]/i.test(url);
}

interface Replacement {
  html: string;
}

/**
 * Render inline Markdown to trusted HTML.
 *
 * Uses null-delimited placeholders so that already-built trusted HTML survives
 * the final text escape, then restores placeholders in reverse storage order
 * so nested spans (e.g. italic inside a bold run) resolve correctly.
 */
function renderInline(raw: string): string {
  const store: Replacement[] = [];
  const keep = (html: string): string => {
    store.push({ html });
    return `\u0000${store.length - 1}\u0000`;
  };

  let text = raw;

  // 1. inline code — innermost, hides every other marker from later steps.
  text = text.replace(/`([^`\n]+?)`/g, (_m, code: string) => keep(`<code>${escapeHtml(code)}</code>`));

  // 2. markdown links [label](url)
  text = text.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (_m, label: string, url: string) => {
    if (isSafeUrl(url)) {
      const href = escapeHtml(url);
      const labelHtml = escapeHtml(label);
      return keep(
        `<a href="${href}" target="_blank" rel="noreferrer nofollow noopener">${labelHtml}</a>`,
      );
    }
    return keep(escapeHtml(`[${label}](${url})`));
  });

  // 3. bare-URL autolinks (http/https only), preserving the leading boundary.
  //    Trailing sentence punctuation is stripped from the href and kept as text.
  //    The \u0002 mark is an internal hard line break and acts as a URL boundary.
  text = text.replace(/(^|[\s\u0002(])(https?:\/\/[^\s<>)\]\u0002]+)/g, (_m, pre, url) => {
    const stripped = url.replace(/[.,;:!?)]+$/, "");
    const trail = url.slice(stripped.length);
    url = stripped;
    if (!isSafeUrl(url)) return pre + url + trail;
    const href = escapeHtml(url);
    return `${pre}${keep(`<a href="${href}" target="_blank" rel="noreferrer nofollow noopener">${href}</a>`)}${trail}`;
  });

  // 4. bold — does not cross newlines (inline runs are single lines).
  text = text.replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, (_m, content: string) => keep(`<strong>${escapeHtml(content)}</strong>`));

  // 5. italics — `*` and `_`, both flanked by non-word boundaries so intraword
  //    underscores (e.g. TOBY_RUNE3) and mid-word stars are left untouched.
  text = text.replace(/(?<![A-Za-z0-9])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![A-Za-z0-9])/g, (_m, content: string) => keep(`<em>${escapeHtml(content)}</em>`));
  text = text.replace(/(?<![A-Za-z0-9])_(?!\s)([^_\n]+?)(?<!\s)_(?![A-Za-z0-9])/g, (_m, content: string) => keep(`<em>${escapeHtml(content)}</em>`));

  // 6. escape all remaining literal text. Placeholders survive (no HTML specials).
  text = escapeHtml(text);

  // 7. restore trusted HTML, highest index first so nested spans resolve.
  for (let index = store.length - 1; index >= 0; index -= 1) {
    text = text.replace(new RegExp(`\\u0000${index}\\u0000`, 'g'), store[index].html);
  }
  return text;
}

function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

function headingLevel(line: string): number | null {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  return match[1].length;
}

function isHorizontalRule(line: string): boolean {
  return /^\s*([-*_])\1{2,}\s*$/.test(line);
}

function isBlockquote(line: string): boolean {
  return /^> ?/.test(line);
}

function stripBlockquote(line: string): string {
  return line.replace(/^> ?/, '');
}

const LIST_MARKER = /^([-*+])\s+/;

function listMarker(line: string): string | null {
  const match = line.match(LIST_MARKER);
  return match ? match[1] : null;
}

function indentSize(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/**
 * Render a flow of source lines as one inline run, joining each pair of lines
 * with either a hard break (`\u0002`, later restored to `<br>`) or a soft space.
 * Letting emphasis span the join is what lets `*Toby is the people.<br>…*` work.
 */
function renderFlow(lines: string[], breaks: Array<'hard' | 'soft'>): string {
  let joined = '';
  for (let i = 0; i < lines.length; i += 1) {
    joined += lines[i];
    if (i < lines.length - 1) joined += breaks[i] === 'hard' ? '\u0002' : ' ';
  }
  return renderInline(joined).replace(/\u0002/g, '<br>');
}

/** Render a run of list-item lines (already split from the source) into a `<ul>`. */
function renderList(lines: string[]): string {
  const items: string[] = [];
  let currentItem: string[] | null = null;

  const flush = () => {
    if (currentItem && currentItem.length > 0) {
      items.push(currentItem.join('\n'));
      currentItem = null;
    }
  };

  for (const line of lines) {
    const marker = listMarker(line.trimStart());
    if (marker && indentSize(line) === 0) {
      flush();
      currentItem = [line.replace(LIST_MARKER, '')];
    } else if (indentSize(line) >= 2) {
      // indented continuation or nested content belongs to the current item
      if (!currentItem) currentItem = [];
      currentItem.push(line.replace(/^\s{2,}/, ''));
    } else if (!isBlank(line)) {
      // non-indented, non-marker text ends the list defensively
      flush();
      items.push(line);
    } else {
      flush();
    }
  }
  flush();

  const renderedItems = items.map((item) => {
    const itemLines = item.split('\n');
    // split nested markers (indented `- `) into a nested <ul>
    const nested = itemLines.filter((l) => /^\s*[-*+]\s+/.test(l));
    const own = itemLines.filter((l) => !/^\s*[-*+]\s+/.test(l)).map((l) => l.trim()).filter(Boolean);
    const parts: string[] = [];
    if (own.length > 0) {
      parts.push(renderFlow(own, own.map(() => 'hard')));
    }
    if (nested.length > 0) {
      parts.push(renderList(nested.map((l) => l.replace(/^\s*/, ''))));
    }
    return `  <li>${parts.join('\n')}</li>`;
  });

  return `<ul>\n${renderedItems.join('\n')}\n</ul>`;
}

function renderParagraph(lines: string[]): string {
  const trimmed = lines.map((line) => line.replace(/\s+$/, ''));
  const breaks = lines.map((line) => (/ {2,}$/.test(line) ? 'hard' : 'soft'));
  return `<p>${renderFlow(trimmed, breaks)}</p>`;
}

function renderBlockquote(lines: string[]): string {
  // group consecutive stripped lines into stanzas by empty lines; within a
  // stanza each source line becomes a line (preserving primary-evidence form)
  const stanzas: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    const stripped = stripBlockquote(line);
    if (stripped.trim() === '') {
      if (current.length > 0) {
        stanzas.push(current);
        current = [];
      }
    } else {
      current.push(stripped);
    }
  }
  if (current.length > 0) stanzas.push(current);

  const paragraphs = stanzas.map((stanza) => {
    const breaks = stanza.map(() => 'hard' as const);
    return `<p>${renderFlow(stanza, breaks)}</p>`;
  });
  return `<blockquote>\n${paragraphs.join('\n')}</blockquote>`;
}

/** Render a canonical Markdown string into a trusted HTML fragment. */
export function renderMarkdown(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';

  const lines = raw.split('\n');
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push('<hr />');
      i += 1;
      continue;
    }

    const level = headingLevel(line);
    if (level !== null) {
      const text = line.replace(/^#{1,6}\s+/, '').replace(/\s*#*\s*$/, '');
      // offset by one so canonical `##` sections sit beneath the folio h2 label
      const renderedLevel = Math.min(level + 1, 6);
      blocks.push(`<h${renderedLevel}>${renderInline(text)}</h${renderedLevel}>`);
      i += 1;
      continue;
    }

    if (isBlockquote(line)) {
      const quote: string[] = [];
      while (i < lines.length && (isBlockquote(lines[i]) || isBlank(lines[i]))) {
        if (isBlank(lines[i]) && (i + 1 >= lines.length || !isBlockquote(lines[i + 1]))) {
          // allow a single blank line inside a quote; stop on a real break
          break;
        }
        quote.push(lines[i]);
        i += 1;
      }
      blocks.push(renderBlockquote(quote));
      continue;
    }

    if (listMarker(line.trimStart())) {
      const list: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const trimmed = lines[i];
        if (listMarker(trimmed.trimStart()) || indentSize(trimmed) >= 2) {
          list.push(trimmed);
          i += 1;
        } else {
          break;
        }
      }
      blocks.push(renderList(list));
      continue;
    }

    // paragraph: consecutive lines that are not blank and not another block
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !isHorizontalRule(lines[i]) &&
      headingLevel(lines[i]) === null &&
      !isBlockquote(lines[i]) &&
      !listMarker(lines[i].trimStart())
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(renderParagraph(para));
  }

  return blocks.join('\n');
}

/** Escape arbitrary text as plain HTML — exposed for tests and fail-safe rendering. */
export { escapeHtml, isSafeUrl };