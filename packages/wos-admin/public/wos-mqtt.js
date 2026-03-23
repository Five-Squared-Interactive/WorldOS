/**
 * WorldOS Admin — MQTT WebSocket Client
 *
 * Shared helper for plugin admin panels to communicate with plugins
 * over the MQTT bridge (WebSocket → MQTT → Plugin → MQTT → WebSocket).
 */

/** Check if an MQTT topic matches a pattern (supports + single-level and # multi-level wildcards) */
function _topicMatches(pattern, topic) {
  if (pattern === topic) return true;
  const pp = pattern.split('/'), tp = topic.split('/');
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '#') return true;
    if (i >= tp.length) return false;
    if (pp[i] !== '+' && pp[i] !== tp[i]) return false;
  }
  return pp.length === tp.length;
}

let _ws = null;
let _connected = false;
let _pending = new Map();         // correlationId → { resolve, timer }
let _subscriptions = new Map();   // topic → Set<callback>
let _connectPromise = null;

/** Connect to the MQTT bridge WebSocket. Returns a promise that resolves on success. */
export function connect() {
  if (_connected && _ws?.readyState === 1) return Promise.resolve();
  if (_connectPromise) return _connectPromise;

  _connectPromise = new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    _ws = new WebSocket(`${proto}//${location.host}/ws?token=open`);

    _ws.onopen = () => {};

    _ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'connected') {
        _connected = true;
        _connectPromise = null;
        resolve();
        return;
      }

      if (msg.type === 'message' && msg.topic) {
        // Route to topic subscribers (supports + and # MQTT wildcards)
        for (const [pattern, cbs] of _subscriptions) {
          if (_topicMatches(pattern, msg.topic)) {
            for (const cb of cbs) cb(msg.payload, msg.topic);
          }
        }
      }
    };

    _ws.onclose = () => {
      _connected = false;
      _connectPromise = null;
      // Reject all pending requests
      for (const [, p] of _pending) {
        clearTimeout(p.timer);
        p.resolve(null);
      }
      _pending.clear();
    };

    _ws.onerror = () => {
      _connectPromise = null;
      reject(new Error('WebSocket connection failed'));
    };
  });

  return _connectPromise;
}

/** Subscribe to an MQTT topic via the bridge. */
export function subscribe(topic, callback) {
  if (!_subscriptions.has(topic)) {
    _subscriptions.set(topic, new Set());
    if (_ws?.readyState === 1) {
      _ws.send(JSON.stringify({ action: 'subscribe', topic }));
    }
  }
  _subscriptions.get(topic).add(callback);
}

/** Unsubscribe a callback from a topic. */
export function unsubscribe(topic, callback) {
  const cbs = _subscriptions.get(topic);
  if (cbs) {
    cbs.delete(callback);
    if (cbs.size === 0) {
      _subscriptions.delete(topic);
      if (_ws?.readyState === 1) {
        _ws.send(JSON.stringify({ action: 'unsubscribe', topic }));
      }
    }
  }
}

/** Publish to an MQTT topic via the bridge. */
export function publish(topic, payload) {
  if (_ws?.readyState === 1) {
    _ws.send(JSON.stringify({ action: 'publish', topic, payload }));
  }
}

/**
 * Send a request and wait for a correlated response.
 * @param {string} requestTopic - MQTT topic to publish to
 * @param {string} responseTopic - MQTT topic to listen for response
 * @param {object} payload - Request payload (correlationId added automatically)
 * @param {number} timeoutMs - Timeout in ms (default 3000)
 * @returns {Promise<object|null>} Response payload or null on timeout
 */
export async function request(requestTopic, responseTopic, payload = {}, timeoutMs = 3000) {
  await connect();

  const correlationId = crypto.randomUUID();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe(responseTopic, handler);
      _pending.delete(correlationId);
      resolve(null);
    }, timeoutMs);

    const handler = (msg) => {
      if (msg?.correlationId === correlationId) {
        clearTimeout(timer);
        unsubscribe(responseTopic, handler);
        _pending.delete(correlationId);
        resolve(msg);
      }
    };

    _pending.set(correlationId, { resolve, timer });
    subscribe(responseTopic, handler);
    publish(requestTopic, { ...payload, correlationId });
  });
}

/** Check if currently connected. */
export function isConnected() {
  return _connected && _ws?.readyState === 1;
}
