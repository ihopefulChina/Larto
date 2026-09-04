/**
 * Release notes arrive as GitHub-rendered HTML (electron-updater's GitHub provider) or as
 * whatever a generic feed carries. The shell renderer owns the IPC bridge, so nothing from the
 * feed may run or load here: the markup is rebuilt from an inert DOMParser document keeping only
 * structural/inline elements and `http(s)` links. Anything else is unwrapped to its text.
 */
const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'code',
  'pre',
  'br',
  'hr',
  'blockquote',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td'
])

export function sanitizeReleaseNotes(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = doc.createElement('div')
  copyChildren(doc.body, out)
  return out.innerHTML
}

/** True when the notes are plain text (or markdown) rather than markup. */
export function isMarkup(notes: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(notes)
}

function copyChildren(from: Node, to: Node): void {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      to.appendChild(to.ownerDocument!.createTextNode(child.nodeValue ?? ''))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'template') continue
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown wrapper (div, span, img, details…): keep its text, drop the element.
      copyChildren(el, to)
      continue
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? ''
      if (!/^https?:\/\//i.test(href)) {
        // Anything but a web URL (javascript:, relative, mailto…) is not a link here.
        copyChildren(el, to)
        continue
      }
      const link = to.ownerDocument!.createElement('a')
      link.setAttribute('href', href)
      copyChildren(el, link)
      to.appendChild(link)
      continue
    }
    const clone = to.ownerDocument!.createElement(tag)
    copyChildren(el, clone)
    to.appendChild(clone)
  }
}
