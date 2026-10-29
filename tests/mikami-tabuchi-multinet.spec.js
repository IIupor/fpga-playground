'use strict';

const { test, expect } = require('@playwright/test');
const { routeMikamiTabuchi } = require('../routing/mikami-tabuchi');

function routeObstacles(path, halfWidth = 2) {
  const rects = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    rects.push({
      left: Math.min(a.x, b.x) - (a.y === b.y ? 0 : halfWidth),
      right: Math.max(a.x, b.x) + (a.y === b.y ? 0 : halfWidth),
      top: Math.min(a.y, b.y) - (a.x === b.x ? 0 : halfWidth),
      bottom: Math.max(a.y, b.y) + (a.x === b.x ? 0 : halfWidth)
    });
  }
  return rects;
}

function segments(path) {
  return path.slice(1).map((p, i) => [path[i], p]);
}

function relation(a, b) {
  const [p, q] = a, [r, s] = b;
  const ah = p.y === q.y, bh = r.y === s.y;
  if (ah && bh) {
    if (p.y !== r.y) return 'none';
    const lo = Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x));
    const hi = Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x));
    return hi < lo ? 'none' : hi === lo ? 'touch' : 'overlap';
  }
  if (!ah && !bh) {
    if (p.x !== r.x) return 'none';
    const lo = Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y));
    const hi = Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y));
    return hi < lo ? 'none' : hi === lo ? 'touch' : 'overlap';
  }
  const h = ah ? [p, q] : [r, s];
  const v = ah ? [r, s] : [p, q];
  const x = v[0].x, y = h[0].y;
  if (x < Math.min(h[0].x, h[1].x) || x > Math.max(h[0].x, h[1].x) ||
      y < Math.min(v[0].y, v[1].y) || y > Math.max(v[0].y, v[1].y)) return 'none';
  const endpointH = x === h[0].x || x === h[1].x;
  const endpointV = y === v[0].y || y === v[1].y;
  return endpointH && endpointV ? 'touch' : 'cross';
}

function assertNoCrossings(a, b) {
  for (const sa of segments(a)) {
    for (const sb of segments(b)) {
      expect(relation(sa, sb), JSON.stringify({ sa, sb })).toBe('none');
    }
  }
}

function routePair(firstStart, firstEnd, secondStart, secondEnd, obstacles = []) {
  const first = routeMikamiTabuchi(firstStart, firstEnd, obstacles);
  expect(first).not.toBeNull();
  const reserved = [...obstacles, ...routeObstacles(first)];
  const second = routeMikamiTabuchi(secondStart, secondEnd, reserved);
  expect(second).not.toBeNull();
  assertNoCrossings(first, second);
  return { first, second };
}

test('MT-MN-01: second net routes around a horizontal first net', () => {
  const result = routePair(
    { x: 0, y: 0 }, { x: 100, y: 0 },
    { x: 50, y: -50 }, { x: 50, y: 50 }
  );
  expect(result.first.length).toBeGreaterThanOrEqual(2);
  expect(result.second.length).toBeGreaterThanOrEqual(3);
});

test('MT-MN-02: two independent nets avoid each other with a block obstacle', () => {
  routePair(
    { x: 0, y: -30 }, { x: 100, y: -30 },
    { x: 50, y: -70 }, { x: 50, y: 40 },
    [{ left: 40, right: 60, top: -10, bottom: 10 }]
  );
});

test('MT-MN-03: second net avoids a bent first route', () => {
  const result = routePair(
    { x: 0, y: 0 }, { x: 80, y: 80 },
    { x: 0, y: 80 }, { x: 80, y: 0 }
  );
  expect(result.first.length).toBeGreaterThanOrEqual(3);
  expect(result.second.length).toBeGreaterThanOrEqual(3);
});

test('MT-MN-04: three sequential nets remain geometrically separated', () => {
  const a = routeMikamiTabuchi({ x: 0, y: 0 }, { x: 120, y: 0 });
  expect(a).not.toBeNull();
  const b = routeMikamiTabuchi({ x: 0, y: 40 }, { x: 120, y: 40 }, routeObstacles(a));
  expect(b).not.toBeNull();
  const c = routeMikamiTabuchi({ x: 60, y: -40 }, { x: 60, y: 80 },
    [...routeObstacles(a), ...routeObstacles(b)]);
  expect(c).not.toBeNull();
  assertNoCrossings(a, b);
  assertNoCrossings(a, c);
  assertNoCrossings(b, c);
});
