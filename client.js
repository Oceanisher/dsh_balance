window.__ModuleLoader__.load({
  id: '@local/dsh-balance',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Automatic re-read cadence while the page stays open. */
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    /** A reading younger than this serves every mounted pill without another request. */
    const CACHE_TTL_MS = 15 * 1000;
    /** Fallback when the boot payload carries no runtime version. */
    const FALLBACK_CLIENT_VERSION = '0.2.2-rc.1';

    const CURRENCY_SYMBOLS = { CNY: '\u00a5', USD: '$' };

    /** Stand-in for a Session hook the shell did not forward to this entry. */
    const NO_HOOK = () => undefined;

    /** Trailing delay that merges the several signals one Turn settle emits. */
    const SETTLE_DEBOUNCE_MS = 1500;

    const CSS = [
      '.dsh-balance-anchor{display:inline-flex;align-items:center;order:1}',
      '.dsh-balance-pill{display:inline-flex;align-items:center;gap:4px;margin:0;padding:3px 2px;',
      'border:0;background:0 0;border-radius:4px;font-size:12px;line-height:18px;',
      'font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.dsh-balance-pill:focus-visible{outline:none;color:var(--dsw-alias-label-secondary)}',
      '@media (hover:hover){.dsh-balance-pill:hover{color:var(--dsw-alias-label-secondary)}}',
      '.dsh-balance-icon{flex:none;display:block}',
    ].join('');

    /** @returns the UI language tag in effect right now. */
    function uiLanguage() {
      const declared = document.documentElement && document.documentElement.lang;
      return String(declared || navigator.language || 'en');
    }

    /** @returns true when the page renders Chinese copy. */
    function isChinese() {
      return uiLanguage().toLowerCase().indexOf('zh') === 0;
    }

    /** @returns copy for one message key in the current page language. */
    function copy(key) {
      const zh = isChinese();
      switch (key) {
        case 'prefix': return zh ? '\u4f59\u989d ' : 'Balance ';
        case 'refresh': return zh ? '\u70b9\u51fb\u5237\u65b0' : 'click to refresh';
        case 'recharge': return zh ? '\u5145\u503c\u4f59\u989d' : 'Recharged';
        case 'bonus': return zh ? '\u8d60\u9001\u4f59\u989d' : 'Bonus credit';
        default: return '';
      }
    }

    /** @returns the runtime's own version, or the bundled fallback. */
    function clientVersion() {
      const boot = window.__DSH_BOOT__;
      if (boot && typeof boot === 'object') {
        if (typeof boot.version === 'string' && boot.version !== '') return boot.version;
        if (boot.product && typeof boot.product.version === 'string' && boot.product.version !== '') return boot.product.version;
      }
      return FALLBACK_CLIENT_VERSION;
    }

    /**
     * Format one Platform decimal string the way the account screen does: two
     * decimals with digit grouping, positive sub-cent values as `<0.01`, and
     * negative magnitudes never shown below 0.01.
     * @param text - decimal string from Platform.
     * @returns display text, or the unchanged string when it is not numeric.
     */
    function formatAmount(text) {
      const value = Number(text);
      if (!Number.isFinite(value)) return String(text);
      if (value > 0 && value < 0.01) return '<0.01';
      let magnitude = Math.round(Math.abs(value) * 100) / 100;
      if (magnitude > 0) magnitude = Math.max(magnitude, 0.01);
      const signed = value < 0 ? -magnitude : magnitude;
      try {
        return signed.toLocaleString(uiLanguage(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch {
        return signed.toFixed(2);
      }
    }

    /** @returns `¥12.34` for one wallet; an unknown currency keeps its code. */
    function walletText(wallet) {
      const symbol = CURRENCY_SYMBOLS[wallet.currency];
      const amount = formatAmount(wallet.balance);
      return symbol === undefined ? wallet.currency + ' ' + amount : symbol + amount;
    }

    /** @returns true for a wallet row carrying a usable balance string. */
    function isWallet(wallet) {
      return wallet !== null && typeof wallet === 'object' && typeof wallet.balance === 'string';
    }

    /**
     * Monochrome outline wallet, drawn to match the shipped 16px icons: no fill,
     * `currentColor` stroke, round caps, so it inherits the pill's text color.
     * @returns the icon element.
     */
    function WalletIcon() {
      return h('svg', {
        className: 'dsh-balance-icon',
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        'aria-hidden': true,
        focusable: 'false',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('rect', { x: 1.9, y: 3.6, width: 12.2, height: 8.8, rx: 2 }),
        h('path', { d: 'M1.9 6.6h12.2' }),
        h('circle', { cx: 11.3, cy: 9, r: 1.05 }));
    }

    /** Latest reader bound by the mounted plugin, so the dock control works even
     * when the slot does not forward injected props. */
    let activeReader = null;

    /**
     * Render the dock control. It reads on mount, after every settled Turn, when
     * the window regains focus or becomes visible, on click, and every five
     * minutes as a safety net.
     */
    function BalancePill(props) {
      const readBalance = props.readBalance || activeReader;
      const [view, setView] = React.useState(null);
      const latestReader = React.useRef(readBalance);
      latestReader.current = readBalance;
      const reloadRef = React.useRef(() => {});

      // The dock entry receives the Conversation shell's Session hooks. A Turn
      // settle shows up as `running` going true -> false, and every completed
      // model attempt advances `tokenUsage`; either edge re-reads the balance.
      const useSessionSafe = typeof props.useSession === 'function' ? props.useSession : NO_HOOK;
      const useProjectionSafe = typeof props.useProjection === 'function' ? props.useProjection : NO_HOOK;
      const running = useSessionSafe((snapshot) => (snapshot === undefined || snapshot === null ? undefined : snapshot.running));
      const usage = useProjectionSafe('tokenUsage');
      const turnSignature = usage === undefined || usage === null
        ? ''
        : [usage.uncachedInputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.outputTokens].join(':');
      const previousRunning = React.useRef(running);
      const previousTurn = React.useRef(turnSignature);
      const settleTimer = React.useRef(null);

      const scheduleSettle = () => {
        if (settleTimer.current !== null) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null;
          reloadRef.current();
        }, SETTLE_DEBOUNCE_MS);
      };

      React.useEffect(() => {
        const was = previousRunning.current;
        previousRunning.current = running;
        if (was === true && running === false) scheduleSettle();
      }, [running]);

      React.useEffect(() => {
        const was = previousTurn.current;
        previousTurn.current = turnSignature;
        if (was !== turnSignature) scheduleSettle();
      }, [turnSignature]);

      React.useEffect(() => {
        let alive = true;
        const load = async (force) => {
          let reading;
          try {
            reading = await latestReader.current(force === true);
          } catch {
            return;
          }
          if (!alive) return;
          if (reading === null || reading === undefined || reading.status !== 'ready') {
            setView(null);
            return;
          }
          const wallets = Array.isArray(reading.value) ? reading.value.filter(isWallet) : [];
          if (wallets.length === 0) {
            setView(null);
            return;
          }
          const bonus = Array.isArray(reading.bonusWallets) ? reading.bonusWallets.filter(isWallet) : [];
          const detail = [
            copy('recharge') + '\uff1a' + wallets.map(walletText).join(' \u00b7 '),
            bonus.length > 0 ? copy('bonus') + '\uff1a' + bonus.map(walletText).join(' \u00b7 ') : null,
            copy('refresh'),
          ].filter((line) => line !== null).join('\uff1b');
          setView({ amount: wallets.map(walletText).join(' \u00b7 '), detail });
        };
        load();
        reloadRef.current = () => { load(true); };
        const timer = setInterval(load, REFRESH_INTERVAL_MS);
        const onFocus = () => { load(); };
        const onVisibility = () => {
          if (document.visibilityState === 'visible') load();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          alive = false;
          clearInterval(timer);
          if (settleTimer.current !== null) {
            clearTimeout(settleTimer.current);
            settleTimer.current = null;
          }
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onVisibility);
        };
      }, []);

      if (view === null) return null;
      // The dock row is a flex container whose only other child is the context
      // meter rendered after the slot, so `order: 1` puts this last.
      return h('span', { className: 'dsh-balance-anchor', 'data-composer-stat': 'balance' },
        h('button', {
          type: 'button',
          className: 'dsh-balance-pill',
          title: view.detail,
          'aria-label': copy('prefix') + view.amount + ' \u2014 ' + copy('refresh'),
          onClick: () => { reloadRef.current(); },
        },
          h(WalletIcon),
          h('span', null, view.amount)));
    }

    return {
      inject: ['slots', 'remote', 'remote.account'],
      apply(ctx) {
        const account = () => {
          const remote = ctx.remote;
          return remote && remote.account && typeof remote.account.getBalance === 'function' ? remote.account : null;
        };

        let cached;
        let cachedAt = 0;
        let inflight = null;

        /** @returns one cached-or-live balance reading; null when the account is absent. */
        const readBalance = (force) => {
          const now = Date.now();
          if (force !== true && cached !== undefined && now - cachedAt < CACHE_TTL_MS) return Promise.resolve(cached);
          if (inflight !== null) return inflight;
          const api = account();
          if (api === null) return Promise.resolve(null);
          const request = api.getBalance({
            version: clientVersion(),
            locale: uiLanguage(),
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          }).then((result) => {
            const value = result && result.ok === true ? result.value : null;
            cached = value;
            cachedAt = Date.now();
            return value;
          }).catch(() => {
            cached = undefined;
            return null;
          }).finally(() => {
            if (inflight === request) inflight = null;
          });
          inflight = request;
          return request;
        };

        ctx.effect(() => {
          activeReader = readBalance;
          return () => {
            if (activeReader === readBalance) activeReader = null;
          };
        }, 'dsh-balance: reader binding');

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.dshBalance = '';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => { tag.remove(); };
        }, 'dsh-balance: pill styles');

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'balance',
          order: 2,
          inject: () => ({ readBalance: (force) => readBalance(force) }),
        }, BalancePill));
      },
    };
  },
});
