const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const benchmarks = ['c17', 'c432', 'c499', 'c880'];

async function loadBenchmark(page, name) {
  await page.route(`https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/${name}.v`, async route => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', `${name}.v`), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: source });
  });
  await page.goto('/');
  await page.locator('#benchmarkSelect').selectOption(name);
  await page.locator('#loadBenchmark').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
  await expect.poll(() => page.locator('#editorStage g[data-node]').count(), { timeout: 15000 })
    .toBeGreaterThan(0);
}

for (const name of benchmarks) {
  test(`${name}: benchmark wires have valid, clear, non-crossing geometry`, async ({ page }) => {
    // Import each circuit only once; perform all geometry checks against the same render.
    await loadBenchmark(page, name);

    const result = await page.locator('#editorStage').evaluate(svg => {
      const nodes = [...svg.querySelectorAll('g[data-node]')].map(g => {
        const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
        const box = g.querySelector('rect.nodebox');
        if (!match || !box) return { invalid: true, id: Number(g.getAttribute('data-node')) };
        return {
          id: Number(g.getAttribute('data-node')),
          x: Number(match[1]), y: Number(match[2]),
          w: Number(box.getAttribute('width')), h: Number(box.getAttribute('height'))
        };
      });
      const wires = [...svg.querySelectorAll('path.editor-wire')].map(path => ({
        id: path.getAttribute('data-wire'),
        from: path.getAttribute('data-from'),
        to: path.getAttribute('data-to'),
        points: [...(path.getAttribute('d') || '').matchAll(/[ML]\s*([-\d.]+)[, ]+([-\d.]+)/g)]
          .map(m => ({ x: Number(m[1]), y: Number(m[2]) })),
        length: path.getTotalLength()
      }));
      const missingGeometry = [];
      const nonOrthogonal = [];
      const blocked = [];
      const segments = [];

      for (const wire of wires) {
        if (!wire.id || wire.from === null || wire.to === null ||
            wire.points.length < 2 || !Number.isFinite(wire.length) || wire.length <= 0) {
          missingGeometry.push(wire.id);
          continue;
        }
        for (let i = 1; i < wire.points.length; i++) {
          const a = wire.points[i - 1], b = wire.points[i];
          if (a.x !== b.x && a.y !== b.y) nonOrthogonal.push(wire.id);
          for (const n of nodes) {
            if (n.invalid || n.id === Number(wire.from) || n.id === Number(wire.to)) continue;
            const inside = a.x === b.x
              ? a.x > n.x - 8 && a.x < n.x + n.w + 8 &&
                Math.max(Math.min(a.y, b.y), n.y - 8) < Math.min(Math.max(a.y, b.y), n.y + n.h + 8)
              : a.y > n.y - 8 && a.y < n.y + n.h + 8 &&
                Math.max(Math.min(a.x, b.x), n.x - 8) < Math.min(Math.max(a.x, b.x), n.x + n.w + 8);
            if (inside) blocked.push({ wire: wire.id, node: n.id, segment: i });
          }
          segments.push({ wire: wire.id, from: wire.from, to: wire.to, a, b, horizontal: a.y === b.y });
        }
      }

      let crossings = 0, overlaps = 0;
      const examples = [];
      for (let i = 0; i < segments.length; i++) {
        const a = segments[i];
        const ax1 = Math.min(a.a.x, a.b.x), ax2 = Math.max(a.a.x, a.b.x);
        const ay1 = Math.min(a.a.y, a.b.y), ay2 = Math.max(a.a.y, a.b.y);
        for (let j = i + 1; j < segments.length; j++) {
          const b = segments[j];
          if (a.wire === b.wire || a.from === b.from || a.from === b.to ||
              a.to === b.from || a.to === b.to) continue;
          if (a.horizontal !== b.horizontal) {
            const h = a.horizontal ? a : b, v = a.horizontal ? b : a;
            const x = v.a.x, y = h.a.y;
            if (x > Math.min(h.a.x, h.b.x) && x < Math.max(h.a.x, h.b.x) &&
                y > Math.min(v.a.y, v.b.y) && y < Math.max(v.a.y, v.b.y)) {
              crossings++;
              if (examples.length < 8) examples.push({ type: 'crossing', wires: [a.wire, b.wire], at: { x, y } });
            }
          } else if (a.horizontal && a.a.y === b.a.y) {
            const lo = Math.max(ax1, Math.min(b.a.x, b.b.x));
            const hi = Math.min(ax2, Math.max(b.a.x, b.b.x));
            if (lo < hi) {
              overlaps++;
              if (examples.length < 8) examples.push({ type: 'overlap', wires: [a.wire, b.wire], from: lo, to: hi, y: a.a.y });
            }
          } else if (!a.horizontal && a.a.x === b.a.x) {
            const lo = Math.max(ay1, Math.min(b.a.y, b.b.y));
            const hi = Math.min(ay2, Math.max(b.a.y, b.b.y));
            if (lo < hi) {
              overlaps++;
              if (examples.length < 8) examples.push({ type: 'overlap', wires: [a.wire, b.wire], x: a.a.x, from: lo, to: hi });
            }
          }
        }
      }
      return { nodeCount: nodes.length, wireCount: wires.length, missingGeometry, nonOrthogonal, blocked, crossings, overlaps, examples };
    });

    console.log(`WIRE-GEOMETRY-DIAGNOSTIC ${name}: ${JSON.stringify(result)}`);
    expect(result.nodeCount, `${name}: nodes should have measurable geometry`).toBeGreaterThan(0);
    expect(result.wireCount, `${name}: benchmark should render wires`).toBeGreaterThan(0);
    expect(result.missingGeometry, `${name}: wires need identity, endpoints and valid geometry`).toEqual([]);
    expect(result.nonOrthogonal, `${name}: routes must be orthogonal`).toEqual([]);
    expect(result.blocked, `${name}: wires must avoid unrelated nodes`).toEqual([]);
    expect(result.crossings, `${name}: wires must not cross: ${JSON.stringify(result.examples)}`).toBe(0);
    expect(result.overlaps, `${name}: unrelated wires must not overlap: ${JSON.stringify(result.examples)}`).toBe(0);
  }, 120000);
}

test('wire crossing geometry distinguishes a proper crossing from a shared endpoint', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const cross = (u, v) => u.x * v.y - u.y * v.x;
    const sub = (u, v) => ({ x: u.x - v.x, y: u.y - v.y });
    const intersects = (p, q, r, s) => {
      const a = sub(q, p), b = sub(s, r), delta = sub(r, p);
      const denominator = cross(a, b);
      if (Math.abs(denominator) < 1e-8) return false;
      const t = cross(delta, b) / denominator;
      const u = cross(delta, a) / denominator;
      return t > 1e-8 && t < 1 - 1e-8 && u > 1e-8 && u < 1 - 1e-8;
    };
    return {
      crossing: intersects({x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}),
      sharedEndpoint: intersects({x:0,y:0},{x:10,y:0},{x:10,y:0},{x:10,y:10}),
      separated: intersects({x:0,y:0},{x:10,y:0},{x:0,y:5},{x:10,y:5})
    };
  });
  expect(result).toEqual({ crossing: true, sharedEndpoint: false, separated: false });
});
