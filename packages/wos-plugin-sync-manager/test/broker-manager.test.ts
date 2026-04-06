// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockProcess, mockSocket } = vi.hoisted(() => {
  const mockProcess = {
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
  };

  const mockSocket = {
    connect: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  return { mockProcess, mockSocket };
});

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProcess),
}));

vi.mock('net', () => ({
  Socket: vi.fn(() => mockSocket),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  mkdtempSync: vi.fn(() => '/tmp/wos-mosquitto-test'),
}));

import { BrokerManager } from '../src/broker-manager.js';
import { spawn } from 'child_process';

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('BrokerManager', () => {
  let broker: BrokerManager;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
    broker = new BrokerManager(logger as any);

    // Default: TCP connect succeeds immediately
    mockSocket.connect.mockImplementation((_port: number, _host: string, cb: Function) => {
      cb();
      return mockSocket;
    });
    mockSocket.on.mockReturnValue(mockSocket);
  });

  afterEach(async () => {
    if (broker.isRunning) {
      await broker.stop();
    }
  });

  describe('start', () => {
    it('should spawn Mosquitto with correct config', async () => {
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });

      expect(spawn).toHaveBeenCalledWith(
        'mosquitto',
        expect.arrayContaining(['-c']),
        expect.objectContaining({ detached: true }),
      );
    });

    it('should generate config with correct ports', async () => {
      const fs = await import('fs');
      await broker.start({ tcpPort: 2883, wsPort: 9083, mosquittoPath: 'mosquitto' });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('mosquitto.conf'),
        expect.stringMatching(/listener 2883/),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('mosquitto.conf'),
        expect.stringMatching(/listener 9083/),
      );
    });

    it('should include allow_anonymous in config', async () => {
      const fs = await import('fs');
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/allow_anonymous true/),
      );
    });

    it('should verify TCP readiness before resolving', async () => {
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });

      expect(mockSocket.connect).toHaveBeenCalledWith(
        1883,
        'localhost',
        expect.any(Function),
      );
    });

    it('should store process PID', async () => {
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });

      expect(broker.pid).toBe(12345);
    });

    it('should set isRunning to true after start', async () => {
      expect(broker.isRunning).toBe(false);
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });
      expect(broker.isRunning).toBe(true);
    });
  });

  describe('stop', () => {
    it('should kill the Mosquitto process', async () => {
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });
      await broker.stop();

      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it('should remove temp config file', async () => {
      const fs = await import('fs');
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });
      await broker.stop();

      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should remove temp directory', async () => {
      const fs = await import('fs');
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });
      await broker.stop();

      expect(fs.rmdirSync).toHaveBeenCalledWith('/tmp/wos-mosquitto-test');
    });

    it('should set isRunning to false', async () => {
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });
      await broker.stop();

      expect(broker.isRunning).toBe(false);
    });

    it('should be idempotent', async () => {
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });
      await broker.stop();
      await expect(broker.stop()).resolves.not.toThrow();
    });
  });

  describe('process crash handling', () => {
    it('should emit crashed event on unexpected process exit', async () => {
      const crashHandler = vi.fn();
      broker.on('crashed', crashHandler);

      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });

      // Find the 'exit' handler registered on the mock process
      const exitCall = mockProcess.on.mock.calls.find((c: any[]) => c[0] === 'exit');
      expect(exitCall).toBeDefined();

      // Simulate unexpected exit
      exitCall![1](1, null);

      expect(crashHandler).toHaveBeenCalledWith(expect.objectContaining({ code: 1 }));
    });

    it('should set isRunning to false on crash', async () => {
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: 'mosquitto' });

      const exitCall = mockProcess.on.mock.calls.find((c: any[]) => c[0] === 'exit');
      exitCall![1](1, null);

      expect(broker.isRunning).toBe(false);
    });
  });

  describe('platform-specific paths', () => {
    it('should use provided mosquitto path', async () => {
      await broker.start({ tcpPort: 1883, wsPort: 8083, mosquittoPath: '/usr/local/bin/mosquitto' });

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/mosquitto',
        expect.any(Array),
        expect.any(Object),
      );
    });
  });
});
