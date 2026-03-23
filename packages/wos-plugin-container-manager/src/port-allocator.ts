// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export class PortAllocator {
  private allocations = new Map<string, Record<number, number>>();
  private allocatedPorts = new Set<number>();

  constructor(
    private readonly rangeStart: number,
    private readonly rangeEnd: number,
  ) {}

  allocate(containerName: string, containerPort: number): number {
    for (let port = this.rangeStart; port <= this.rangeEnd; port++) {
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        const existing = this.allocations.get(containerName) ?? {};
        existing[containerPort] = port;
        this.allocations.set(containerName, existing);
        return port;
      }
    }
    throw new Error('port_exhaustion: no available ports in configured range');
  }

  release(containerName: string): void {
    const ports = this.allocations.get(containerName);
    if (ports) {
      for (const hostPort of Object.values(ports)) {
        this.allocatedPorts.delete(hostPort);
      }
      this.allocations.delete(containerName);
    }
  }

  getAllocated(containerName: string): Record<number, number> {
    return this.allocations.get(containerName) ?? {};
  }

  getAllAllocated(): Map<string, Record<number, number>> {
    return new Map(this.allocations);
  }

  isAllocated(port: number): boolean {
    return this.allocatedPorts.has(port);
  }

  restore(allocations: Map<string, Record<number, number>>): void {
    for (const [containerName, ports] of allocations) {
      this.allocations.set(containerName, { ...ports });
      for (const hostPort of Object.values(ports)) {
        this.allocatedPorts.add(hostPort);
      }
    }
  }
}
