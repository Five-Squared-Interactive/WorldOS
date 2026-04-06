// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MockRosbridgeServer } from './mock-rosbridge-server.js';

describe('Integration: Plugin Lifecycle (mock)', () => {
  let server: MockRosbridgeServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('mock rosbridge server starts and stops cleanly', async () => {
    server = new MockRosbridgeServer();
    await server.start();

    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);

    await server.stop();
  });

  it('mock server handles subscribe and publish', async () => {
    server = new MockRosbridgeServer();
    await server.start();

    const { WebSocket } = await import('ws');

    const ws = new WebSocket(server.url);

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ op: 'subscribe', topic: '/test', type: 'std_msgs/String' }));
        resolve();
      });
    });

    // Give time for subscribe to be processed
    await new Promise((r) => setTimeout(r, 50));

    // Set up message listener before publishing
    const msgPromise = new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()));
    });

    // Server publishes to subscribers
    server.publishToSubscribers('/test', { data: 'hello' });

    const received = JSON.parse(await msgPromise);
    expect(received.op).toBe('publish');
    expect(received.topic).toBe('/test');
    expect(received.msg).toEqual({ data: 'hello' });

    ws.close();
  });

  it('mock server handles service calls', async () => {
    server = new MockRosbridgeServer();
    await server.start();

    server.onService('/add', (args: any) => ({
      result: true,
      values: { sum: (args?.a ?? 0) + (args?.b ?? 0) },
    }));

    const { WebSocket } = await import('ws');
    const ws = new WebSocket(server.url);

    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    const responsePromise = new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()));
    });

    ws.send(JSON.stringify({
      op: 'call_service',
      service: '/add',
      args: { a: 3, b: 4 },
      id: 'req-1',
    }));

    const response = JSON.parse(await responsePromise);
    expect(response.op).toBe('service_response');
    expect(response.result).toBe(true);
    expect(response.values).toEqual({ sum: 7 });
    expect(response.id).toBe('req-1');

    ws.close();
  });
});
