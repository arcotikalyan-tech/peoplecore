import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { timedFetch } from './timed-fetch';

// A server that never answers: what a stalled connection to the database looks like.
const server = createServer(() => {});
let url = '';
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

describe('timedFetch', () => {
  it('gives up on a request that never answers', async () => {
    const started = Date.now();
    await expect(timedFetch(200)(url)).rejects.toThrow(/timeout|aborted/i);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("keeps the caller's own signal", async () => {
    const caller = new AbortController();
    const pending = timedFetch(10_000)(url, { signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
  });
});
