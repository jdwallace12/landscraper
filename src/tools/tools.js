/**
 * Sculpting tool definitions.
 * Each tool has a name, icon, color, and an apply() function.
 */

export const TOOLS = {
  raise: {
    name: 'Raise',
    icon: '⛰️',
    color: '#4ade80',
    cursor: 'crosshair',
    isBrush: true,
    apply(heightmap, res, cx, cz, radius, strength) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        heightmap[i] += strength * falloff;
      });
    },
  },

  lower: {
    name: 'Lower',
    icon: '🕳️',
    color: '#60a5fa',
    cursor: 'crosshair',
    isBrush: true,
    apply(heightmap, res, cx, cz, radius, strength) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        heightmap[i] -= strength * falloff;
      });
    },
  },

  flatten: {
    name: 'Flatten',
    icon: '⬜',
    color: '#fbbf24',
    cursor: 'crosshair',
    isBrush: true,
    _targetHeight: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart) {
      if (isStart || this._targetHeight === null) {
        const ci = Math.round(cz) * res + Math.round(cx);
        this._targetHeight = heightmap[ci] ?? 0;
      }
      const target = this._targetHeight;
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        heightmap[i] += (target - heightmap[i]) * falloff * strength * 0.3;
      });
    },
  },

  smooth: {
    name: 'Smooth',
    icon: '🌊',
    color: '#c084fc',
    cursor: 'crosshair',
    isBrush: true,
    apply(heightmap, res, cx, cz, radius, strength) {
      // We need a copy to read from while writing
      const copy = new Float32Array(heightmap);
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const x = i % res;
        const z = Math.floor(i / res);
        let sum = 0, count = 0;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, nz = z + dz;
            if (nx >= 0 && nx < res && nz >= 0 && nz < res) {
              sum += copy[nz * res + nx];
              count++;
            }
          }
        }
        const avg = sum / count;
        heightmap[i] += (avg - heightmap[i]) * falloff * strength * 0.5;
      });
    },
  },

  plateau: {
    name: 'Plateau',
    icon: '🏔️',
    color: '#f472b6',
    cursor: 'crosshair',
    isBrush: true,
    _targetHeight: null,
    apply(heightmap, res, cx, cz, radius, strength, isStart) {
      if (isStart || this._targetHeight === null) {
        const ci = Math.round(cz) * res + Math.round(cx);
        this._targetHeight = heightmap[ci] ?? 0;
      }
      const target = this._targetHeight;
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        if (heightmap[i] < target) {
          heightmap[i] += strength * falloff * 0.5;
          if (heightmap[i] > target) heightmap[i] = target;
        }
      });
    },
  },

  roughen: {
    name: 'Roughen',
    icon: '⚡',
    color: '#8b5cf6',
    cursor: 'crosshair',
    isBrush: true,
    apply(heightmap, res, cx, cz, radius, strength) {
      applyBrush(heightmap, res, cx, cz, radius, (i, falloff) => {
        const noise = (Math.random() - 0.5) * 2.0; // Random fast peaks/valleys
        heightmap[i] += noise * strength * falloff;
      });
    },
  },

  trees: {
    name: 'Trees',
    icon: '🌲',
    color: '#34d399',
    cursor: 'crosshair',
    isBrush: false,  // handled specially in main.js
    isTree: true,
    apply() { /* no-op — tree placement handled externally */ },
  },

  demolish: {
    name: 'Demolish',
    icon: '💥',
    color: '#ef4444',
    cursor: 'crosshair',
    isBrush: false,
    isDemolish: true,
    apply() { /* no-op — handled externally */ },
  },

  skier: {
    name: 'Skier',
    icon: '⛷️',
    color: '#e63946',
    cursor: 'crosshair',
    isBrush: false,
    isSkier: true,
    apply() { /* no-op — skier placement handled externally */ },
  },

  chairlift: {
    name: 'Chairlift',
    icon: '🚡',
    color: '#3b82f6',
    cursor: 'crosshair',
    isBrush: false,
    isChairlift: true,
    apply() { /* no-op — handled externally */ },
  },
};

/**
 * Generic brush applicator with Gaussian falloff.
 */
function applyBrush(heightmap, res, cx, cz, radius, fn) {
  const r = Math.ceil(radius);
  const gx = Math.round(cx);
  const gz = Math.round(cz);

  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = gx + dx;
      const z = gz + dz;
      if (x < 0 || x >= res || z < 0 || z >= res) continue;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > radius) continue;
      // Gaussian falloff
      const falloff = Math.exp(-((dist * dist) / (2 * (radius * 0.45) ** 2)));
      const i = z * res + x;
      fn(i, falloff);
    }
  }
}
