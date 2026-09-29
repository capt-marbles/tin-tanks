import { INPUT } from '@tin-tanks/shared/constants';

const KEYMAP = {
  KeyW: INPUT.UP, ArrowUp: INPUT.UP,
  KeyS: INPUT.DOWN, ArrowDown: INPUT.DOWN,
  KeyA: INPUT.LEFT, ArrowLeft: INPUT.LEFT,
  KeyD: INPUT.RIGHT, ArrowRight: INPUT.RIGHT,
  Space: INPUT.FIRE,
};

export class Input {
  constructor() {
    this.mask = 0;
    this.enabled = false;
    this.onToggleMute = null;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.mask = 0; });
  }

  onKey(e, down) {
    if (!this.enabled) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (down && e.code === 'KeyM' && !e.repeat && this.onToggleMute) this.onToggleMute();
    const bit = KEYMAP[e.code];
    if (!bit) return;
    e.preventDefault();
    if (down) this.mask |= bit;
    else this.mask &= ~bit;
  }
}
