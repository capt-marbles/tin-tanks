import { TANK_PAINT } from '@tin-tanks/shared/constants';

const el = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.scores = el('scores');
    this.status = el('status');
    this.feed = el('killfeed');
    this.hpfill = el('hpfill');
    this.message = el('message');
    this.messageTimer = null;
  }

  updateScores(roster, states, myId) {
    const rows = roster
      .map((r) => ({ ...r, s: states.get(r.id) }))
      .sort((a, b) => ((b.s?.kills || 0) - (a.s?.kills || 0)) || ((a.s?.deaths || 0) - (b.s?.deaths || 0)));
    this.scores.innerHTML = rows.map((r) => {
      const paint = TANK_PAINT[r.slot % TANK_PAINT.length];
      const color = `#${paint.hull.toString(16).padStart(6, '0')}`;
      return `<tr class="${r.id === myId ? 'me' : ''}"><td><span class="swatch" style="background:${color}"></span>${escape(r.name)}</td><td class="num">${r.s?.kills ?? 0}</td><td class="num" style="opacity:.6">${r.s?.deaths ?? 0}</td></tr>`;
    }).join('');
  }

  updateStatus(ping, players, muted) {
    this.status.textContent = `${players}/4 tanks · ${ping} ms${muted ? ' · muted' : ''}`;
  }

  updateHp(hp, alive) {
    const pct = alive ? Math.max(0, hp) : 0;
    this.hpfill.style.width = `${pct}%`;
    this.hpfill.classList.toggle('low', pct <= 34);
  }

  addFeed(text) {
    const div = document.createElement('div');
    div.textContent = text;
    this.feed.appendChild(div);
    while (this.feed.children.length > 5) this.feed.removeChild(this.feed.firstChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 6000);
  }

  showMessage(title, sub = '', ms = 2500) {
    this.message.innerHTML = `${escape(title)}${sub ? `<small>${escape(sub)}</small>` : ''}`;
    this.message.classList.add('show');
    clearTimeout(this.messageTimer);
    if (ms > 0) this.messageTimer = setTimeout(() => this.hideMessage(), ms);
  }

  hideMessage() {
    this.message.classList.remove('show');
  }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
