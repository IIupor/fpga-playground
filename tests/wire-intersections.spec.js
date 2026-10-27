const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const benchmarks = ['c17', 'c432', 'c499', 'c880'];

for (const name of benchmarks) {
  test(name + ': routed interconnects have no proper crossings', async ({ page }) => {
    // Keep the integration test deterministic and independent of GitHub raw-content availability.
    await page.route(`https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/${name}.v`, async route => {
      const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', `${name}.v`), 'utf8');
      await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: source });
    });
    await page.goto('/');
    await page.locator('#benchmarkSelect').selectOption(name);
    await page.locator('#loadBenchmark').click();
    await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
    await expect.poll(async () => page.locator('#editorStage g[data-node]').count(), { timeout: 15000 })
      .toBeGreaterThan(0);
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
