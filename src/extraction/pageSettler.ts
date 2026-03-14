export type WaitUntil = 'load' | 'domcontentloaded' | 'network-idle-like';

export interface PageSettleOptions {
  mode: WaitUntil;
  maxWaitMs: number;
  stabilityMs: number;
  pollIntervalMs: number;
  minTextLength: number;
  fastPathThreshold: number;
  idleMs: number;
  minWaitMs: number;
}

export interface PageSettleResult {
  reason: 'precheck' | 'stabilized' | 'timeout';
  waitedMs: number;
  textLength: number;
}

export async function waitForPageSettled(opts: PageSettleOptions): Promise<PageSettleResult> {
  const startTime = Date.now();
  const globalObj = globalThis as {
    document?: { body?: { innerText?: string | null; textContent?: string | null } | null };
    MutationObserver?: new (callback: () => void) => {
      observe: (target: unknown, options: unknown) => void;
      disconnect: () => void;
    };
    fetch?: (...args: unknown[]) => Promise<unknown>;
    XMLHttpRequest?: { prototype?: { send?: (...args: unknown[]) => unknown } };
  };

  const getTextLen = (): number => {
    const body = globalObj.document?.body;
    const text = (body?.innerText ?? body?.textContent ?? '').trim();
    return text.length;
  };

  const precheckTextLen = getTextLen();
  if (precheckTextLen >= opts.fastPathThreshold) {
    return {
      reason: 'precheck',
      waitedMs: 0,
      textLength: precheckTextLen,
    };
  }

  let observer: { observe: (target: unknown, options: unknown) => void; disconnect: () => void } | null = null;
  let lastMutationTime = Date.now();

  if (globalObj.document?.body && globalObj.MutationObserver) {
    observer = new globalObj.MutationObserver(() => {
      lastMutationTime = Date.now();
    });
    observer.observe(globalObj.document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }

  let inFlight = 0;
  let idleSince = Date.now();
  let restoreFetch: (() => void) | null = null;
  let restoreXhrSend: (() => void) | null = null;

  if (opts.mode === 'network-idle-like') {
    const originalFetch = globalObj.fetch;
    if (typeof originalFetch === 'function') {
      globalObj.fetch = async (...args: unknown[]): Promise<unknown> => {
        inFlight += 1;
        idleSince = 0;
        const result = originalFetch(...args);
        return Promise.resolve(result).finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          if (inFlight === 0) {
            idleSince = Date.now();
          }
        });
      };
      restoreFetch = () => {
        globalObj.fetch = originalFetch;
      };
    }

    const xhrProto = globalObj.XMLHttpRequest?.prototype;
    const originalSend = xhrProto?.send;

    if (xhrProto && typeof originalSend === 'function') {
      xhrProto.send = function wrappedSend(...args: unknown[]): unknown {
        inFlight += 1;
        idleSince = 0;

        const current = this as {
          addEventListener?: (event: string, listener: () => void, options?: { once?: boolean }) => void;
        };

        const finalize = (): void => {
          inFlight = Math.max(0, inFlight - 1);
          if (inFlight === 0) {
            idleSince = Date.now();
          }
        };

        if (typeof current.addEventListener === 'function') {
          current.addEventListener('loadend', finalize, { once: true });
        }

        try {
          return originalSend.apply(this, args);
        } catch (error) {
          finalize();
          throw error;
        }
      };

      restoreXhrSend = () => {
        xhrProto.send = originalSend;
      };
    }
  }

  try {
    let previousTextLength = getTextLen();
    let stableLengthPolls = 0;
    const deadline = startTime + Math.max(0, opts.maxWaitMs);

    while (Date.now() < deadline) {
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, Math.max(10, opts.pollIntervalMs));
      });

      const now = Date.now();
      const currentTextLength = getTextLen();

      if (currentTextLength === previousTextLength) {
        stableLengthPolls += 1;
      } else {
        stableLengthPolls = 1;
      }
      previousTextLength = currentTextLength;

      const lengthStable = stableLengthPolls >= 3;
      const domQuiet = now - lastMutationTime >= opts.stabilityMs;
      const hasContent = currentTextLength >= opts.minTextLength;
      const networkIdle =
        opts.mode !== 'network-idle-like' ||
        (inFlight === 0 && now - idleSince >= opts.idleMs);

      const elapsedMs = now - startTime;
      const pastMinWait = elapsedMs >= (opts.minWaitMs ?? 0);

      if (lengthStable && domQuiet && hasContent && networkIdle && pastMinWait) {
        return {
          reason: 'stabilized',
          waitedMs: Math.max(0, elapsedMs),
          textLength: currentTextLength,
        };
      }
    }
    const endTime = Date.now();
    return {
      reason: 'timeout',
      waitedMs: Math.max(0, endTime - startTime),
      textLength: getTextLen(),
    };
  } finally {
    observer?.disconnect();
    restoreFetch?.();
    restoreXhrSend?.();
  }
}

export function buildPageSettlerScript(opts: PageSettleOptions): string {
  return `(${waitForPageSettled.toString()})(${JSON.stringify(opts)})`;
}
