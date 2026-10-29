const { test, expect } = require('@playwright/test');
const { routeMikamiTabuchi } = require('../routing/mikami-tabuchi');

function assertOrthogonal(path) {
  expect(path).not.toBeNull();
  for (let i = 1; i < path.length; i++) {
    expect(path[i - 1].x === path[i].x || path[i - 1].y === path[i].y).toBe(true);
  }
}
function assertAvoids(path, obstacles, clearance = 8) {
  const rects = obstacles.map(r => ({
    left: r.left - clearance, right: r.right + clearance,
    top: r.top - clearance, bottom: r.bottom + clearance
  }));
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    for (const r of rects) {
      if (a.y === b.y && a.y > r.top && a.y < r.bottom) {
        expect(Math.max(Math.min(a.x, b.x), r.left) < Math.min(Math.max(a.x, b.x), r.right)).toBe(false);
      } else if (a.x === b.x && a.x > r.left && a.x < r.right) {
        expect(Math.max(Math.min(a.y, b.y), r.top) < Math.min(Math.max(a.y, b.y), r.bottom)).toBe(false);
      }
    }
  }
}

test('MT-01: connects aligned terminals with a straight segment', () => {
  const p = routeMikamiTabuchi({ x: 0, y: 0 }, { x: 100, y: 0 });
  expect(p[0]).toEqual({ x: 0, y: 0 });
  expect(p[p.length - 1]).toEqual({ x: 100, y: 0 });
  assertOrthogonal(p);
});

test('MT-02: connects terminals requiring one bend', () => {
  const p = routeMikamiTabuchi({ x: 0, y: 0 }, { x: 100, y: 80 });
  assertOrthogonal(p);
  expect(p[0]).toEqual({ x: 0, y: 0 });
  expect(p[p.length - 1]).toEqual({ x: 100, y: 80 });
});

test('MT-03: routes around a single rectangular obstacle', () => {
  const obs = [{ left: 40, right: 60, top: -20, bottom: 20 }];
  const p = routeMikamiTabuchi({ x: 0, y: 0 }, { x: 100, y: 0 }, obs);
  assertOrthogonal(p); assertAvoids(p, obs);
});

test('MT-04: routes around a vertical obstacle wall with a gap above', () => {
  const obs = [{ left: 40, right: 60, top: 10, bottom: 100 }];
  const p = routeMikamiTabuchi({ x: 0, y: 0 }, { x: 100, y: 0 }, obs);
  assertOrthogonal(p); assertAvoids(p, obs);
});

test('MT-05: routes around a U-shaped arrangement', () => {
  const obs = [
    { left: 30, right: 50, top: 20, bottom: 90 },
    { left: 50, right: 100, top: 70, bottom: 90 },
    { left: 80, right: 100, top: 20, bottom: 70 }
  ];
  const p = routeMikamiTabuchi({ x: 0, y: 50 }, { x: 120, y: 50 }, obs);
  assertOrthogonal(p); assertAvoids(p, obs);
});

test('MT-06: keeps every segment outside all block keep-out rectangles', () => {
  const obs = [
    { left: 20, right: 40, top: -10, bottom: 30 },
    { left: 60, right: 80, top: 20, bottom: 60 },
    { left: 100, right: 120, top: -20, bottom: 20 }
  ];
  const p = routeMikamiTabuchi({ x: 0, y: 0 }, { x: 140, y: 40 }, obs);
  assertOrthogonal(p); assertAvoids(p, obs);
});

test('MT-07: returns null when a terminal lies inside an obstacle keep-out', () => {
  expect(routeMikamiTabuchi({ x: 50, y: 50 }, { x: 100, y: 50 },
    [{ left: 40, right: 60, top: 40, bottom: 60 }])).toBeNull();
});

test('MT-08: handles identical source and target coordinates', () => {
  expect(routeMikamiTabuchi({ x: 12, y: 34 }, { x: 12, y: 34 })).toEqual([{ x: 12, y: 34 }]);
});

test('MT-09: rejects malformed terminal coordinates', () => {
  expect(() => routeMikamiTabuchi({ x: NaN, y: 0 }, { x: 10, y: 10 })).toThrow(TypeError);
});

test('MT-10: repeated runs produce deterministic orthogonal routes', () => {
  const s = { x: 0, y: 0 }, e = { x: 120, y: 60 };
  const obs = [{ left: 30, right: 50, top: -10, bottom: 30 }, { left: 70, right: 90, top: 30, bottom: 80 }];
  const a = routeMikamiTabuchi(s, e, obs), b = routeMikamiTabuchi(s, e, obs);
  expect(a).toEqual(b);
  assertOrthogonal(a); assertAvoids(a, obs);
});