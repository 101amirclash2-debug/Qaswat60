/**
 * Minimal, dependency-free Markdown renderer that is safe by construction:
 * every character is HTML-escaped *before* any formatting is applied, and only
 * a fixed set of tags is ever produced. Model output can never inject markup.
 */

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ESCAPE[c]);
}

function safeHref(url) {
  // `url` comes from text that is already HTML-escaped, so re-escaping would
  // turn `&amp;` into `&amp;amp;`. Only the scheme needs validation.
  const value = String(url || '').trim();
  if (/^https?:\/\/\S+$/i.test(value)) return value;
  return null;
}

/** Inline formatting on already-escaped text. */
function inline(escaped) {
  let out = escaped;
  // `code`
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // **bold**
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // *italic* (avoid touching ** leftovers)
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  // [label](url) — scheme validated on the raw value, label already escaped
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const href = safeHref(url);
    return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>` : label;
  });
  return out;
}

/**
 * @param {string} markdown
 * @returns {string} safe HTML
 */
export function renderMarkdown(markdown) {
  const source = String(markdown ?? '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const html = [];
  let inCode = false;
  let codeLines = [];
  let listType = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```(\w+)?\s*$/);
    if (fence) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(4, heading[1].length) + 2; // h3..h6 keeps page hierarchy
      html.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inline(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushParagraph();
      const type = ul ? 'ul' : 'ol';
      if (listType !== type) {
        closeList();
        html.push(`<${type}>`);
        listType = type;
      }
      html.push(`<li>${inline(escapeHtml((ul || ol)[1]))}</li>`);
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html.push('<hr>');
      continue;
    }

    paragraph.push(line.trim());
  }

  if (inCode && codeLines.length) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  flushParagraph();
  closeList();
  return html.join('\n');
}

/** One-line, truncated preview used in session lists and logs. */
export function plainPreview(text, max = 90) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
