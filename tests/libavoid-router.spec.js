'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function waitForLibavoid(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    if (!window.fpgaLibavoidReady) throw new Error('libavoid module bootstrap was not registered');
    await window.fpgaLibavoidReady;
  });
  await expect.poll(() => page.evaluate(() => window.fpgaLibavoidReadyState)).toBe(true);
}

async function loadBenchmark(page, name) {
  await page.route(`https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/${name}.v`, async route => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', `${name}.v`), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: source });
  });
  await page.locator('#benchmarkSelect').selectOption(name);
  await page.locator('#loadBenchmark').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 60000 });
}

test('LIBAVOID-01: libavoid routes every c17 net orthogonally without overlaps or block penetration', async ({ page }) => {
  test.setTimeout(120000);
  await waitForLibavoid(page);
  await loadBenchmark(page, 'c17');

  const baseline = await page.evaluate(() => ({
    nodes: window.fpgaNodes.map(n => ({ id: n.id, x: n.x, y: n.y, type: n.type, name: n.name })),
    wires: window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]).sort((a,b) => a[0]-b[0])
  }));

  await page.locator('#routingMode').selectOption('libavoid');
  await expect.poll(() => page.locator('#editorStage path.editor-wire').count()).toBe(baseline.wires.length);

  const result = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('#editorStage path.editor-wire')];
    const audit = window.fpgaAuditRouteGeometry();
    const routes = paths.map(path => {
      const nums = (path.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number);
      let orthogonal = nums.length >= 4 && nums.length % 2 === 0;
      for (let i = 2; i < nums.length; i += 2) {
        if (Math.abs(nums[i] - nums[i-2]) > 0.001 && Math.abs(nums[i+1] - nums[i-1]) > 0.001) orthogonal = false;
      }
      return { wire: Number(path.dataset.wire), pointCount: nums.length / 2, orthogonal };
    });
    return {
      routes,
      audit,
      connectivity: window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]).sort((a,b) => a[0]-b[0])
    };
  });

  expect(result.routes).toHaveLength(baseline.wires.length);
  expect(result.routes.every(r => r.pointCount >= 2 && r.orthogonal)).toBe(true);
  expect(result.connectivity).toEqual(baseline.wires);
  expect(result.audit.conflicts.filter(c => c.type === 'overlap' || c.type === 'block-penetration')).toEqual([]);
  console.log('LIBAVOID-C17 ' + JSON.stringify({
    routed: result.routes.length,
    orthogonal: result.routes.every(r => r.orthogonal),
    overlaps: result.audit.conflicts.filter(c => c.type === 'overlap').length,
    blockPenetrations: result.audit.conflicts.filter(c => c.type === 'block-penetration').length,
    logicalConnectivityPreserved: true
  }));
});

test('LIBAVOID-02: parallel independent connectors are nudged into separate corridors', async ({ page }) => {
  await waitForLibavoid(page);

  const result = await page.evaluate(() => {
    const nodes = [
      { id: 1, type: 'INPUT', name: 'A', x: 0, y: 0, inputs: 0, outputs: 1 },
      { id: 2, type: 'OUTPUT', name: 'Y', x: 360, y: 0, inputs: 1, outputs: 0 },
      { id: 3, type: 'INPUT', name: 'B', x: 0, y: 140, inputs: 0, outputs: 1 },
      { id: 4, type: 'OUTPUT', name: 'Z', x: 360, y: 140, inputs: 1, outputs: 0 }
    ];
    const wires = [
      { id: 11, from: 1, to: 2, toPin: 0 },
      { id: 12, from: 3, to: 4, toPin: 0 }
    ];
    const pin = (node, kind) => ({
      x: node.x + (kind === 'out' ? 112 : 0),
      y: node.y + 30
    });
    const spec = node => ({ w: ['INPUT', 'OUTPUT'].includes(node.type) ? 112 : 150, h: 76 });
    const routes = window.fpgaRouteWithLibavoid(nodes, wires, pin, spec);
    const segments = [];
    for (const [wireId, points] of routes) {
      for (let i = 1; i < points.length; i++) segments.push({ wireId, a: points[i-1], b: points[i] });
    }
    const overlaps = [];
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if (a.wireId === b.wireId) continue;
      if (a.a.y === a.b.y && b.a.y === b.b.y && a.a.y === b.a.y &&
          Math.max(Math.min(a.a.x,a.b.x),Math.min(b.a.x,b.b.x)) < Math.min(Math.max(a.a.x,a.b.x),Math.max(b.a.x,b.b.x))) overlaps.push([a.wireId,b.wireId]);
      if (a.a.x === a.b.x && b.a.x === b.b.x && a.a.x === b.a.x &&
          Math.max(Math.min(a.a.y,a.b.y),Math.min(b.a.y,b.b.y)) < Math.min(Math.max(a.a.y,a.b.y),Math.max(b.a.y,b.b.y))) overlaps.push([a.wireId,b.wireId]);
    }
    return { routeCount: routes.size, points: [...routes.values()], overlaps };
  });

  expect(result.routeCount).toBe(2);
  expect(result.points.every(points => points.length >= 2)).toBe(true);
  expect(result.overlaps).toEqual([]);
  console.log('LIBAVOID-PARALLEL-NETS ' + JSON.stringify({
    routeCount: result.routeCount,
    collinearOverlaps: result.overlaps.length
  }));
});
