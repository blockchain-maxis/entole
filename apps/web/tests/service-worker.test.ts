import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

/**
 * The worker cannot be exercised by rendering a page, so it is exercised
 * directly: `public/sw.js` is evaluated against a stand-in for the worker
 * global, and the handlers it registers are called by hand.
 *
 * The rule under test is the product one. A page request never comes back from
 * a cache, because a cached page is a balance frozen at whatever it said last
 * time, and the product does not show state it cannot vouch for.
 */

const SOURCE = readFileSync(join(__dirname, '../public/sw.js'), 'utf8');
const ORIGIN = 'https://entole.app';

type Handler = (event: Record<string, unknown>) => void;

class FakeCache {
  entries = new Map<string, Response>();

  async add(request: Request) {
    this.entries.set(new URL(request.url).pathname, new Response('offline page'));
  }

  async put(request: Request, response: Response) {
    this.entries.set(new URL(request.url).pathname, response);
  }

  async match(request: Request | string) {
    const url = typeof request === 'string' ? request : request.url;
    return this.entries.get(new URL(url, ORIGIN).pathname);
  }
}

/**
 * Inside a worker a relative URL resolves against the worker's scope. Node's
 * `Request` has no scope to resolve against, so it gets one.
 */
class ScopedRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init);
  }
}

function boot(network: (request: Request) => Promise<Response>) {
  const listeners = new Map<string, Handler>();
  const caches = new Map<string, FakeCache>();
  const opened: string[] = [];

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => listeners.set(type, handler),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };

  const cacheStorage = {
    open: async (name: string) => {
      opened.push(name);
      const existing = caches.get(name) ?? new FakeCache();
      caches.set(name, existing);
      return existing;
    },
    keys: async () => [...caches.keys(), 'entole-shell-v0'],
    delete: vi.fn(async (name: string) => caches.delete(name)),
  };

  vm.runInNewContext(SOURCE, {
    self,
    caches: cacheStorage,
    fetch: network,
    Request: ScopedRequest,
    Response,
    URL,
    Promise,
    Set,
  });

  /** Runs a registered handler and awaits whatever it passed to waitUntil. */
  async function dispatch(type: string, event: Record<string, unknown> = {}) {
    const waited: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    listeners.get(type)?.({
      ...event,
      waitUntil: (promise: Promise<unknown>) => waited.push(promise),
      respondWith: (promise: Promise<Response>) => {
        responded = promise;
      },
    });
    await Promise.all(waited);
    return responded;
  }

  return { dispatch, caches, cacheStorage, self, opened };
}

/** `mode` is read-only on Node's Request, and the worker branches on it. */
function req(path: string, mode: RequestMode, init?: RequestInit) {
  const request = new ScopedRequest(path, init);
  Object.defineProperty(request, 'mode', { value: mode });
  return request;
}

const ok = async () => new Response('from the network');
const offline = async (request: Request): Promise<Response> => {
  throw new TypeError(`Failed to fetch ${request.url}`);
};

function navigation(path = '/') {
  return { request: req(path, 'navigate') };
}

describe('install', () => {
  it('precaches the offline page and takes over immediately', async () => {
    const sw = boot(ok);
    await sw.dispatch('install');

    const shell = sw.caches.get('entole-shell-v1');
    expect(await shell?.match('/offline')).toBeDefined();
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });
});

describe('activate', () => {
  it('drops caches from older versions and keeps this one', async () => {
    const sw = boot(ok);
    await sw.dispatch('install');
    await sw.dispatch('activate');

    expect(sw.cacheStorage.delete).toHaveBeenCalledWith('entole-shell-v0');
    expect(sw.cacheStorage.delete).not.toHaveBeenCalledWith('entole-shell-v1');
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});

describe('pages', () => {
  it('always come from the network, never from a cache', async () => {
    const network = vi.fn(ok);
    const sw = boot(network);
    await sw.dispatch('install');

    const response = await sw.dispatch('fetch', navigation());
    expect(await response?.text()).toBe('from the network');
    expect(network).toHaveBeenCalled();
  });

  it('fall back to the offline page when the network is gone', async () => {
    let connected = true;
    const sw = boot((request) => (connected ? ok() : offline(request)));

    await sw.dispatch('install');
    connected = false;

    const response = await sw.dispatch('fetch', navigation('/activity'));
    expect(await response?.text()).toBe('offline page');
  });
});

describe('requests the worker refuses to touch', () => {
  it('leaves anything that is not a GET alone', async () => {
    const sw = boot(ok);
    const response = await sw.dispatch('fetch', {
      request: req('/pay', 'navigate', { method: 'POST' }),
    });
    expect(response).toBeUndefined();
  });

  it('leaves other origins alone', async () => {
    const sw = boot(ok);
    const response = await sw.dispatch('fetch', {
      request: req('https://example.com/thing.png', 'no-cors'),
    });
    expect(response).toBeUndefined();
  });

  it('leaves same-origin data requests alone', async () => {
    const sw = boot(ok);
    const response = await sw.dispatch('fetch', {
      request: req('/api/activity', 'cors'),
    });
    expect(response).toBeUndefined();
  });
});

describe('build assets', () => {
  it('are served from the cache once they have been seen', async () => {
    const network = vi.fn(ok);
    const sw = boot(network);
    const asset = { request: req('/_next/static/chunk.js', 'no-cors') };

    expect(await (await sw.dispatch('fetch', asset))?.text()).toBe('from the network');
    expect(network).toHaveBeenCalledTimes(1);

    await sw.dispatch('fetch', asset);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('include the icons the installed app draws itself with', async () => {
    const network = vi.fn(ok);
    const sw = boot(network);
    const icon = { request: req('/icons/icon-512.png', 'no-cors') };

    await sw.dispatch('fetch', icon);
    await sw.dispatch('fetch', icon);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
