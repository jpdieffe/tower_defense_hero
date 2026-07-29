type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | number | null | undefined | false;

/** Minimal hyperscript helper - keeps the UI code readable without a framework. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A button that reacts on pointerdown, so it feels instant on touch screens. */
export function tapButton(
  className: string,
  onTap: () => void,
  ...children: Child[]
): HTMLButtonElement {
  const b = el('button', { class: className, type: 'button' }, ...children);
  b.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onTap();
  });
  // Keyboard/desktop fallback.
  b.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') onTap();
  });
  return b;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function toggleClass(node: HTMLElement, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

export function formatTime(ticks: number, tickRate: number): string {
  const secs = Math.max(0, Math.ceil(ticks / tickRate));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

let toastLayer: HTMLElement | null = null;

export function toast(message: string, ms = 2200): void {
  if (!toastLayer) {
    toastLayer = el('div', { class: 'toasts' });
    document.getElementById('ui')?.appendChild(toastLayer);
  }
  const t = el('div', { class: 'toast' }, message);
  toastLayer.appendChild(t);
  window.setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    window.setTimeout(() => t.remove(), 320);
  }, ms);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
