'use strict';

const { test, expect } = require('@playwright/test');
const { routeMikamiTabuchi } = require('../routing/mikami-tabuchi');

function assertValidPath(path, start, end, obstacles, clearance = 8) {
  expect(path, 'router should find a path').not.toBeNull();
  expect(path[0]).toEqual(start);
  expect(path[path.length - 1]).toEqual(end);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    expect(a.x === b.x || a.y === b.y, 'all segments must be orthogonal').toBe(true);
    for (const o of obstacles) {
      const l = o.left - clearance, r = o.right + clearance;
      const t = o.top - clearance, bt = o.bottom + clearance;
      if (a.y === b.y && a.y > t && a.y < bt) {
        expect(Math.max(Math.min(a.x, b.x), l) < Math.min(Math.max(a.x, b.x), r),
          'horizontal segment must not enter an obstacle').toBe(false);
      }
      if (a.x === b.x && a.x > l && a.x < r) {
        expect(Math.max(Math.min(a.y, b.y), t) < Math.min(Math.max(a.y, b.y), bt),
          'vertical segment must not enter an obstacle').toBe(false);
      }
    }
  }
}

// Deterministic stress layouts: every case blocks the direct corridor but leaves
// a route around the obstacles. The changing heights and spacing exercise
// alternate obstacle-edge tracks without relying on random test data.
const layouts = [
  [{ left: 30, right: 44, top: -12, bottom: 12 }],
  [{ left: 25, right: 38, top: -18, bottom: 18 }, { left: 100, right: 116, top: -8, bottom: 8 }],
  [{ left: 20, right: 34, top: -6, bottom: 6 }, { left: 62, right: 78, top: -15, bottom: 15 }, { left: 125, right: 140, top: -9, bottom: 9 }],
  [{ left: 35, right: 52, top: -20, bottom: 20 }, { left: 85, right: 99, top: -10, bottom: 10 }, { left: 145, right: 163, top: -16, bottom: 16 }],
  [{ left: 18, right: 30, top: -9, bottom: 9 }, { left: 48, right: 65, top: -19, bottom: 19 }, { left: 94, right: 108, top: -7, bottom: 7 }, { left: 140, right: 154, top: -13, bottom: 13 }],
  [{ left: 28, right: 43, top: -14, bottom: 14 }, { left: 72, right: 88, top: -6, bottom: 6 }, { left: 118, right: 134, top: -18, bottom: 18 }, { left: 165, right: 178, top: -10, bottom: 10 }],
  [{ left: 22, right: 36, top: -5, bottom: 5 }, { left: 55, right: 69, top: -11, bottom: 11 }, { left: 91, right: 105, top: -17, bottom: 17 }, { left: 130, right: 145, top: -8, bottom: 8 }],
  [{ left: 32, right: 48, top: -17, bottom: 17 }, { left: 78, right: 92, top: -9, bottom: 9 }, { left: 112, right: 129, top: -20, bottom: 20 }, { left: 158, right: 174, top: -6, bottom: 6 }],
  [{ left: 24, right: 39, top: -11, bottom: 11 }, { left: 64, right: 80, top: -20, bottom: 20 }, { left: 104, right: 118, top: -7, bottom: 7 }, { left: 148, right: 164, top: -15, bottom: 15 }],
  [{ left: 19, right: 33, top: -16, bottom: 16 }, { left: 47, right: 61, top: -8, bottom: 8 }, { left: 83, right: 99, top: -19, bottom: 19 }, { left: 123, right: 137, top: -10, bottom: 10 }, { left: 161, right: 177, top: -14, bottom: 14 }]
];

for (let i = 0; i < layouts.length; i++) {
  test(`MT-STRESS-${String(i + 1).padStart(2, '0')}: routes around obstacle layout ${i + 1}`, () => {
    const start = { x: 0, y: 0 }, end = { x: 200, y: 0 };
    const path = routeMikamiTabuchi(start, end, layouts[i]);
    assertValidPath(path, start, end, layouts[i]);
  });
}

test('MT-STRESS-11: route stays valid when obstacle input order is reversed', () => {
  const start = { x: 0, y: 0 }, end = { x: 200, y: 0 };
  const obstacles = layouts[9];
  const forward = routeMikamiTabuchi(start, end, obstacles);
  const reversed = routeMikamiTabuchi(start, end, [...obstacles].reverse());
  assertValidPath(forward, start, end, obstacles);
  assertValidPath(reversed, start, end, obstacles);
});

test('MT-STRESS-12: route remains orthogonal for off-grid terminal coordinates', () => {
  const start = { x: 3.5, y: 2.25 }, end = { x: 201.75, y: -3.5 };
  const obstacles = [
    { left: 32, right: 49, top: -18, bottom: 18 },
    { left: 88, right: 103, top: -13, bottom: 13 },
    { left: 147, right: 163, top: -21, bottom: 21 }
  ];
  const path = routeMikamiTabuchi(start, end, obstacles);
  assertValidPath(path, start, end, obstacles);
});


test('MT-PROFILE-01: exposes search-cost metrics without changing the route', () => {
  const start = { x: 0, y: 0 }, end = { x: 200, y: 0 };
  const obstacles = [
    { left: 30, right: 44, top: -12, bottom: 12 },
    { left: 100, right: 116, top: -8, bottom: 8 }
  ];
  const expected = routeMikamiTabuchi(start, end, obstacles);
  const metrics = {};
  const measured = routeMikamiTabuchi(start, end, obstacles, { metrics });
  expect(measured).toEqual(expected);
  expect(metrics.status).toBe('routed');
  expect(metrics.searchTimeMs).toBeGreaterThanOrEqual(0);
  expect(metrics.coordinateBuildMs).toBeGreaterThanOrEqual(0);
  expect(metrics.xLines).toBeGreaterThan(0);
  expect(metrics.yLines).toBeGreaterThan(0);
  expect(metrics.coordinateLines).toBe(metrics.xLines + metrics.yLines);
  expect(metrics.gridPointCount).toBe(metrics.xLines * metrics.yLines);
  expect(metrics.statesProcessed).toBeGreaterThan(0);
  expect(metrics.raySteps).toBeGreaterThan(0);
  expect(metrics.obstacleChecks).toBe(metrics.obstaclePointChecks + metrics.obstacleSegmentChecks);
  expect(metrics.maxQueueLength).toBeGreaterThan(0);
});

test('MT-PROFILE-02: reports state-limit separately from an unreachable route', () => {
  const metrics = {};
  const path = routeMikamiTabuchi(
    { x: 0, y: 0 }, { x: 100, y: 0 },
    [{ left: 40, right: 60, top: -100, bottom: 100 }],
    { clearance: 0, maxStates: 1, metrics }
  );
  expect(path).toBeNull();
  expect(metrics.status).toBe('state-limit');
  expect(metrics.statesProcessed).toBe(1);
});
