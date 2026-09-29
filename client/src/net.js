// Thin WebSocket wrapper. Messages are JSON; see server/src/index.js for the protocol.

export class Net {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.ping = 0;
    this.handlers = {};
    this._pingTimer = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
    return this;
  }

  emit(type, payload) {
    if (this.handlers[type]) this.handlers[type](payload);
  }

  connect(name) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify({ t: 'join', name }));
        this._pingTimer = setInterval(() => this.sendPing(), 2000);
        this.sendPing();
        resolve();
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'pong') {
          this.ping = Math.round(performance.now() - msg.c);
          return;
        }
        this.emit(msg.t, msg);
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('Could not reach the game server'));
      };
      ws.onclose = (e) => {
        clearInterval(this._pingTimer);
        this.emit('close', e);
        if (!opened) reject(new Error('Connection refused'));
      };
    });
  }

  sendPing() {
    this.send({ t: 'ping', c: performance.now() });
  }

  sendInput(seq, mask) {
    this.send({ t: 'i', s: seq, k: mask });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

/** Work out which server to talk to. */
export function resolveServerUrl() {
  const params = new URLSearchParams(location.search);
  const explicit = params.get('server');
  if (explicit) {
    if (/^wss?:\/\//.test(explicit)) return explicit;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${explicit}`;
  }
  if (import.meta.env.DEV) return 'ws://localhost:8080';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}
