import { h } from './h.js';

/**
 * Renders the markdown GitHub release notes that release-please writes, as DOM nodes.
 * It understands only what those notes contain: "###" section headings, bullet lists,
 * links, `code` and **bold**. Everything is built with text nodes, never innerHTML, so
 * nothing in a release body can inject markup. Links are limited to http(s).
 */

// "([951f0e7](https://github.com/…/commit/951f…))": the commit reference release-please
// appends to every line. It is noise in a changelog, so it is dropped.
const COMMIT_REF = /\s*\(\[[0-9a-f]{7,40}\]\(https?:\/\/[^)\s]+\)\)/g;
const INLINE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;

export function inlineNodes(src) {
  const text = String(src).replace(COMMIT_REF, '');
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) {
      out.push(h('a', { href: m[2], target: '_blank', rel: 'noopener noreferrer', className: 'rn-link' }, m[1]));
    } else if (m[3]) {
      out.push(h('code', { className: 'rn-code' }, m[3]));
    } else {
      out.push(h('strong', {}, m[4]));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * @param {string} body release notes markdown
 * @returns {Node[]} section headings and lists. The release's own "## [x.y.z](…) (date)"
 *   title and the "Container image:" line are left out; the dialog shows those itself.
 */
export function releaseNoteNodes(body) {
  const nodes = [];
  let list = null;
  const flush = () => {
    if (list) nodes.push(list);
    list = null;
  };
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^#{1,2}\s/.test(line)) continue; // the release's own title
    const head = /^#{3,6}\s+(.*)$/.exec(line);
    if (head) {
      flush();
      nodes.push(h('h4', { className: 'rn-section' }, ...inlineNodes(head[1])));
      continue;
    }
    const item = /^\s*[*-]\s+(.*)$/.exec(line);
    if (item) {
      if (!list) list = h('ul', { className: 'rn-list' });
      list.append(h('li', {}, ...inlineNodes(item[1])));
      continue;
    }
    if (/^Container image:/i.test(line.trim())) {
      flush();
      continue;
    }
    flush();
    nodes.push(h('p', { className: 'rn-text' }, ...inlineNodes(line)));
  }
  flush();
  return nodes;
}
