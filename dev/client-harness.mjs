// Offline harness for plugins/dsh-balance/client.js: stubs the module loader,
// React, and Cordis context, then exercises registration, formatting and the
// signed-out path. Not shipped with the plugin.

const captured = [];
globalThis.window = {
  __ModuleLoader__: { load: (def) => captured.push(def) },
  addEventListener() {},
  removeEventListener() {},
};
let styles = [];
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  head: { appendChild: (el) => styles.push(el) },
  createElement: () => ({ dataset: {}, textContent: '', remove() { styles = styles.filter((s) => s !== this); } }),
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
};
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });

// Minimal hook runtime so the component can run outside a renderer.
const hooks = { states: [], refs: [], cursor: 0, effects: [], effectDeps: [], effectCursor: 0 };
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useRef(init) {
    const i = hooks.cursor++;
    if (hooks.refs[i] === undefined) hooks.refs[i] = { current: init };
    return hooks.refs[i];
  },
  useState(init) {
    const i = hooks.cursor++;
    if (hooks.states[i] === undefined) hooks.states[i] = init;
    return [hooks.states[i], (next) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }];
  },
  useEffect(fn, deps) {
    const i = hooks.effectCursor++;
    const previous = hooks.effectDeps[i];
    const changed = previous === undefined
      || deps === undefined
      || deps.length !== previous.length
      || deps.some((value, index) => value !== previous[index]);
    if (!changed) return;
    hooks.effectDeps[i] = deps;
    hooks.effects.push(fn);
  },
};
const fakeRequire = (name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require: ' + name);
};

await import('../client.js');

const assert = (ok, label) => {
  if (!ok) { console.error('FAIL:', label); process.exitCode = 1; } else { console.log('ok:', label); }
};

assert(captured.length === 1, 'client bundle registers one factory');
const def = captured[0];
assert(def.id === '@local/dsh-balance', 'factory id is the package name');
const plugin = def.factory(fakeRequire);
assert(Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.includes('remote') && plugin.inject.includes('remote.account'), 'inject lists slots, remote and remote.account');

let registration;
const reading = {
  ok: true,
  value: {
    status: 'ready',
    value: [{ currency: 'CNY', balance: '12.30' }, { currency: 'USD', balance: '0.004' }],
    bonusWallets: [{ currency: 'CNY', balance: '5' }],
  },
};
let accountMode = 'ready';
let balanceReads = 0;
const ctx = {
  remote: { account: { getBalance: async (meta) => { balanceReads += 1; assert(meta.locale === 'zh-CN', 'client metadata carries the page language'); assert(typeof meta.version === 'string' && meta.version.length > 0, 'client metadata carries a version'); assert(typeof meta.timezoneOffsetSeconds === 'number', 'client metadata carries a zone offset'); return accountMode === 'ready' ? reading : { ok: true, value: null }; } } },
  slots: {
    inject(name, factory) { assert(name === 'conversation.composer.dock', 'injects the composer dock slot'); factory(); },
    register(options, component) { registration = { options, component }; return { dispose() {} }; },
  },
  effect(fn, label) { const cleanup = fn(); assert(typeof cleanup === 'function', 'style effect returns cleanup (' + label + ')'); return cleanup; },
};
plugin.apply(ctx);

assert(registration.options.id === 'balance', 'registers a new dock id, not a replacement');
assert(registration.options.order === 2, 'sits after activity(0) and usage(1)');
assert(styles.length === 1 && styles[0].textContent.includes('.dsh-balance-pill'), 'injects one stylesheet');

const renderWith = (props) => {
  hooks.cursor = 0;
  hooks.effectCursor = 0;
  hooks.effects.length = 0;
  const tree = registration.component(props);
  for (const effect of hooks.effects) effect();
  return tree;
};
const render = () => renderWith(registration.options.inject());

let tree = render();
await new Promise((r) => setTimeout(r, 20));
tree = render();
assert(tree !== null, 'renders once a reading arrives');
assert(tree.props.className === 'dsh-balance-anchor', 'anchors the control so it can sort last in the dock row');
assert(styles[0].textContent.includes('order:1'), 'the anchor carries order:1 for the flex dock');
const button = tree.children[0];
assert(button.type === 'button' && button.props.className === 'dsh-balance-pill', 'renders the refresh control');
const iconElement = button.children[0];
assert(typeof iconElement.type === 'function', 'leads with the wallet icon component');
const icon = iconElement.type(iconElement.props);
assert(icon.type === 'svg' && icon.props.fill === 'none' && icon.props.stroke === 'currentColor', 'renders an outline-only icon that inherits the text color');
assert(icon.props.width === 16 && icon.props.height === 16 && icon.props.strokeWidth === 1.25, 'matches the 16px icon conventions');
assert(icon.children.length === 3, 'draws the wallet body, seam and clasp');
assert(button.children[1].children[0] === '\u00a512.30 \u00b7 $<0.01', 'shows the formatted amount without a text prefix: ' + button.children[1].children[0]);
assert(button.props['aria-label'].includes('\u4f59\u989d'), 'keeps the spoken balance label');
assert(button.props.title.includes('\u5145\u503c\u4f59\u989d') && button.props.title.includes('\u8d60\u9001\u4f59\u989d'), 'tooltip separates recharged and bonus credit');

tree = renderWith({});
await new Promise((r) => setTimeout(r, 20));
tree = renderWith({});
assert(tree !== null && tree.children[0].type === 'button', 'renders without injected props, through the apply-bound reader');

// Turn-settle refresh: the shell forwards useSession/useProjection to dock entries.
let runningState = false;
let usageState;
const shell = () => ({
  useSession: (selector) => selector({ running: runningState }),
  useProjection: (key) => (key === 'tokenUsage' ? usageState : undefined),
});
const shellProps = () => ({ ...registration.options.inject(), ...shell() });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

renderWith(shellProps());
let before = balanceReads;
runningState = true;
renderWith(shellProps());
runningState = false;
renderWith(shellProps());
await sleep(1700);
assert(balanceReads === before + 1, 'a finished Turn (running true -> false) re-reads the balance');

before = balanceReads;
usageState = { uncachedInputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 30 };
renderWith(shellProps());
await sleep(1700);
assert(balanceReads === before + 1, 'a completed model attempt (tokenUsage advance) re-reads the balance');

before = balanceReads;
renderWith(shellProps());
await sleep(1700);
assert(balanceReads === before, 'an unchanged Turn state reads nothing extra');

accountMode = 'signed-out';
button.props.onClick();
await new Promise((r) => setTimeout(r, 20));
tree = render();
assert(tree === null, 'hides when the account is absent');

console.log(process.exitCode ? 'FAILED' : 'ALL PASS');
process.exit(process.exitCode || 0);
