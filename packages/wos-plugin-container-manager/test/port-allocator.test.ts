// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach } from 'vitest';
import { PortAllocator } from '../src/port-allocator.js';

describe('PortAllocator', () => {
  let allocator: PortAllocator;

  beforeEach(() => {
    allocator = new PortAllocator(32768, 32770); // small range for testing
  });

  describe('allocate', () => {
    it('should allocate a port from range', () => {
      const port = allocator.allocate('container-1', 80);
      expect(port).toBe(32768);
    });

    it('should allocate different ports for different containers', () => {
      const p1 = allocator.allocate('container-1', 80);
      const p2 = allocator.allocate('container-2', 80);
      expect(p1).not.toBe(p2);
      expect(p1).toBe(32768);
      expect(p2).toBe(32769);
    });

    it('should allocate different ports for different container ports on same container', () => {
      const p1 = allocator.allocate('container-1', 80);
      const p2 = allocator.allocate('container-1', 443);
      expect(p1).not.toBe(p2);
    });

    it('should throw on port exhaustion', () => {
      allocator.allocate('c1', 80); // 32768
      allocator.allocate('c2', 80); // 32769
      allocator.allocate('c3', 80); // 32770
      expect(() => allocator.allocate('c4', 80)).toThrow('port_exhaustion');
    });
  });

  describe('release', () => {
    it('should release all ports for a container', () => {
      allocator.allocate('container-1', 80);
      allocator.allocate('container-1', 443);
      allocator.release('container-1');
      expect(allocator.getAllocated('container-1')).toEqual({});
    });

    it('should make released ports available', () => {
      allocator.allocate('c1', 80); // 32768
      allocator.allocate('c2', 80); // 32769
      allocator.allocate('c3', 80); // 32770
      allocator.release('c1');
      const port = allocator.allocate('c4', 80);
      expect(port).toBe(32768);
    });
  });

  describe('getAllocated', () => {
    it('should return allocated ports for a container', () => {
      allocator.allocate('container-1', 80);
      allocator.allocate('container-1', 443);
      const allocated = allocator.getAllocated('container-1');
      expect(allocated[80]).toBe(32768);
      expect(allocated[443]).toBe(32769);
    });

    it('should return empty object for unknown container', () => {
      expect(allocator.getAllocated('nonexistent')).toEqual({});
    });
  });

  describe('getAllAllocated', () => {
    it('should return all allocations', () => {
      allocator.allocate('c1', 80);
      allocator.allocate('c2', 80);
      const all = allocator.getAllAllocated();
      expect(all.size).toBe(2);
    });
  });

  describe('isAllocated', () => {
    it('should return true for allocated port', () => {
      allocator.allocate('c1', 80);
      expect(allocator.isAllocated(32768)).toBe(true);
    });

    it('should return false for unallocated port', () => {
      expect(allocator.isAllocated(32768)).toBe(false);
    });
  });

  describe('restore', () => {
    it('should restore allocations from saved state', () => {
      const saved = new Map<string, Record<number, number>>();
      saved.set('c1', { 80: 32768 });
      saved.set('c2', { 80: 32769 });

      allocator.restore(saved);

      expect(allocator.isAllocated(32768)).toBe(true);
      expect(allocator.isAllocated(32769)).toBe(true);
      expect(allocator.getAllocated('c1')).toEqual({ 80: 32768 });

      // Next allocation should skip restored ports
      const next = allocator.allocate('c3', 80);
      expect(next).toBe(32770);
    });
  });
});
