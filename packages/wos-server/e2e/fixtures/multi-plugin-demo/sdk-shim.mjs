/**
 * Module resolution hook that intercepts '@worldos/plugin-sdk' imports
 * and replaces them with a lightweight shim (no real MQTT client needed).
 *
 * Uses a data: URL to register the loader inline, avoiding relative path
 * resolution issues under tsx.
 */
import { register } from 'node:module';

const SDK_SHIM = `
import { EventEmitter } from 'events';

export class WOSPlugin extends EventEmitter {
  constructor() { super(); }
}

export const VERSION = '0.1.0-demo';
`;

const loaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@worldos/plugin-sdk') {
    const shim = ${JSON.stringify(SDK_SHIM)};
    return {
      shortCircuit: true,
      url: 'data:text/javascript;base64,' + Buffer.from(shim).toString('base64'),
    };
  }
  return nextResolve(specifier, context);
}
`;

register(
  'data:text/javascript;base64,' + Buffer.from(loaderCode).toString('base64'),
  import.meta.url,
);
