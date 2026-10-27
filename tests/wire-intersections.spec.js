const { test, expect } = require('@playwright/test');

const benchmarks = ['c17', 'c432', 'c499', 'c880'];

// Sample SVG paths into polylines so the check works for both straight and
// Bezier-routed wires. A crossing is counted only when both segments cross
// through their interiors; shared pin endpoints are intentionally ignored.
function findProperCrossings(paths) {
  const EPS = 1e-5;
  const ENDPOINT_TOLERANCE = 3;

  function intersect(a, b, c, d) {
    const cross = (u, v) => u.x * v.y - u.y * v.x;
    const sub = (u, v) => ({ x: u.x - v.x, y: u.y - v.y });
    const r = sub(b, a), s = sub(d, c);
    const denom = cross(r, s);
    if (Math.abs(denom) < EPS) return null; // parallel or collinear
    const ca = sub(c, a);
    const t = cross(ca, s) / denom;
    const u = cross(ca, r) / denom;
    if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
    return { x: a.x + t * r.x, y: a.y + t * r.y };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  const candidates = paths.map(path => {
    const points = [];
    const steps = Math.max(12, Math.ceil(path.length / 8));
    for (let i = 0; i <= steps; i++) {
      const p = path.getPointAtLength(path.length * i / steps);
      points.push({ x: p.x, y: p.y });
    }
    return {
      id: path.dataset.wire || path.getAttribute('data-wire') || '',
      points,
      start: points[0],
      end: points[points.length - 1],
      minX: Math.min(...points.map(p => p.x)),
      maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)),
      maxY: Math.max(...points.map(p => p.y))
    };
  });

  const crossings = [];
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      // Cheap bounding-box rejection keeps the benchmark checks tractable.
      if (a.maxX < b.minX - EPS || b.maxX < a.minX - EPS ||
          a.maxY < b.minY - EPS || b.maxY < a.minY - EPS) continue;

      let found = null;
      outer: for (let ai = 1; ai < a.points.length; ai++) {
        const p = a.points[ai - 1], q = a.points[ai];
        for (let bi = 1; bi < b.points.length; bi++) {
          const r = b.points[bi - 1], s = b.points[bi];
          const point = intersect(p, q, r, s);
          if (!point) continue;
          // Connections that merely meet at a common source/target pin are OK.
          if (distance(point, a.start) <= ENDPOINT_TOLERANCE ||
              distance(point, a.end) <= ENDPOINT_TOLERANCE ||
              distance(point, b.start) <= ENDPOINT_TOLERANCE ||
              distance(point, b.end) <= ENDPOINT_TOLERANCE) continue;
          found = point;
          break outer;
        }
      }
      if (found) crossings.push({ wireA: a.id || String(i), wireB: b.id || String(j), point: found });
    }
  }
  return crossings;
}

test('wire intersection detector recognizes a proper crossing and ignores a shared endpoint', async ({ page }) => {
  await page.setContent(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <path id="horizontal" d="M0 10 L20 10" />
      <path id="vertical" d="M10 0 L10 20" />
      <path id="touching" d="M20 10 L30 10" />
    </svg>
  `);
  const result = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('path')];
    return paths.map(path => ({
      id: path.id,
      d: path.getAttribute('d'),
      length: path.getTotalLength(),
      points: Array.from({ length: 3 }, (_, i) => {
        const p = path.getPointAtLength(path.getTotalLength() * i / 2);
        return { x: p.x, y: p.y };
      })
    }));
  });
  expect(result).toHaveLength(3);
  expect(result.find(p => p.id === 'horizontal').points[1]).toEqual({ x: 10, y: 10 });
  expect(result.find(p => p.id === 'vertical').points[1]).toEqual({ x: 10, y: 10 });
});

for (const name of benchmarks) {
  test(name + ': routed interconnects have no proper crossings', async ({ page }) => {
    await page.goto('/');
    await page.locator('#benchmarkSelect').selectOption(name);
    await page.locator('#loadBenchmark').click();
    await expect(page.locator('#editorMessage')).toContainText('Loaded', { timeout: 15000 }).catch(async () => {
      // Some versions report a successful benchmark import rather than "Loaded".
      await expect(page.locator('#editorStage g[data-node]')).toHaveCountGreaterThan(0);
    });
    await expect.poll(() => page.locator('#editorStage path.editor-wire').count(), { timeout: 30000 })
      .toBeGreaterThan(0);

    const crossings = await page.locator('#editorStage path.editor-wire').evaluateAll(paths => {
      const EPS = 1e-5;
      const ENDPOINT_TOLERANCE = 3;
      const cross = (u, v) => u.x * v.y - u.y * v.x;
      const sub = (u, v) => ({ x: u.x - v.x, y: u.y - v.y });
      const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const segments = paths.map((path, index) => {
        const length = path.getTotalLength();
        const steps = Math.max(12, Math.ceil(length / 8));
        const points = [];
        for (let k = 0; k <= steps; k++) {
          const p = path.getPointAtLength(length * k / steps);
          points.push({ x: p.x, y: p.y });
        }
        return {
          id: path.getAttribute('data-wire') || String(index),
          points, start: points[0], end: points[points.length - 1],
          minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
          minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y))
        };
      });
      const crossings = [];
      for (let i = 0; i < segments.length; i++) {
        const a = segments[i];
        for (let j = i + 1; j < segments.length; j++) {
          const b = segments[j];
          if (a.maxX < b.minX - EPS || b.maxX < a.minX - EPS ||
              a.maxY < b.minY - EPS || b.maxY < a.minY - EPS) continue;
          let found = null;
          outer: for (let ai = 1; ai < a.points.length; ai++) {
            const p = a.points[ai - 1], q = a.points[ai], rseg = sub(q, p);
            for (let bi = 1; bi < b.points.length; bi++) {
              const r = b.points[bi - 1], s = b.points[bi], sseg = sub(s, r);
              const denom = cross(rseg, sseg);
              if (Math.abs(denom) < EPS) continue;
              const delta = sub(r, p);
              const t = cross(delta, sseg) / denom;
              const u = cross(delta, rseg) / denom;
              if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) continue;
              const point = { x: p.x + t * rseg.x, y: p.y + t * rseg.y };
              if (distance(point, a.start) <= ENDPOINT_TOLERANCE ||
                  distance(point, a.end) <= ENDPOINT_TOLERANCE ||
                  distance(point, b.start) <= ENDPOINT_TOLERANCE ||
                  distance(point, b.end) <= ENDPOINT_TOLERANCE) continue;
              found = point;
              break outer;
            }
          }
          if (found) crossings.push({ wireA: a.id, wireB: b.id, x: Math.round(found.x), y: Math.round(found.y) });
        }
      }
      return crossings;
    });

    expect(crossings, name + ' contains intersecting wire pairs: ' + JSON.stringify(crossings.slice(0, 20)))
      .toEqual([]);
  }, 120000);
}
