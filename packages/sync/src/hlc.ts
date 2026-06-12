// Hybrid Logical Clock — monotonic even under wall-clock regression, totally
// ordered across devices. String form sorts lexicographically:
//   <epochMs padded 15>-<counter padded 6>-<deviceId>

export interface Hlc {
  wallMs: number;
  counter: number;
  deviceId: string;
}

export function hlcToString(h: Hlc): string {
  return `${String(h.wallMs).padStart(15, "0")}-${String(h.counter).padStart(6, "0")}-${h.deviceId}`;
}

export function hlcFromString(s: string): Hlc {
  const wallMs = Number(s.slice(0, 15));
  const counter = Number(s.slice(16, 22));
  const deviceId = s.slice(23);
  return { wallMs, counter, deviceId };
}

export function hlcCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HlcClock {
  private last: Hlc;

  constructor(
    private readonly deviceId: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.last = { wallMs: 0, counter: 0, deviceId };
  }

  /** Produces the next local timestamp. */
  tick(): string {
    const wall = this.now();
    if (wall > this.last.wallMs) {
      this.last = { wallMs: wall, counter: 0, deviceId: this.deviceId };
    } else {
      this.last = { ...this.last, counter: this.last.counter + 1 };
    }
    return hlcToString(this.last);
  }

  /** Advances the clock past a timestamp observed from another device. */
  observe(remote: string): void {
    const r = hlcFromString(remote);
    const wall = this.now();
    const maxWall = Math.max(wall, this.last.wallMs, r.wallMs);
    let counter: number;
    if (maxWall === this.last.wallMs && maxWall === r.wallMs) {
      counter = Math.max(this.last.counter, r.counter) + 1;
    } else if (maxWall === this.last.wallMs) {
      counter = this.last.counter + 1;
    } else if (maxWall === r.wallMs) {
      counter = r.counter + 1;
    } else {
      counter = 0;
    }
    this.last = { wallMs: maxWall, counter, deviceId: this.deviceId };
  }
}
