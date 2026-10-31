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
  // Selecting the benchmark auto-loads it; do not click Load a second time.
  // The caller must choose the router before this selection, otherwise the
  // default router can block the browser while importing a large circuit.
  await page.locator('#benchmarkSelect').selectOption(name);
  await expect(page.locator('#editorMessage')).toContainText(/Imported|Loaded/, { timeout: 60000 });
}

test('LIBAVOID-01: libavoid routes every c17 net orthogonally without overlaps or block penetration', async ({ page }) => {
  test.setTimeout(120000);
  await waitForLibavoid(page);
  await page.locator('#routingMode').selectOption('libavoid');
  await loadBenchmark(page, 'c17');

  const baseline = await page.evaluate(() => ({
    nodes: window.fpgaNodes.map(n => ({ id: n.id, x: n.x, y: n.y, type: n.type, name: n.name })),
    wires: window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]).sort((a,b) => a[0]-b[0])
  }));

  await expect.poll(() => page.locator('#editorStage path.editor-wire').count()).toBe(baseline.wires.length);

  const result = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('#editorStage path.editor-wire')];
    const audit = window.fpgaAuditRouteGeometry();
    const routes = paths.map(path => {
      const nums = (path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
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



test('LIBAVOID-02: libavoid routes the complete c432 benchmark without overlaps or block penetration', async ({ page }) => {
  test.setTimeout(240000);
  await waitForLibavoid(page);
  // Activate libavoid before import: c432 must never invoke the slow legacy router.
  await page.locator('#routingMode').selectOption('libavoid');
  await loadBenchmark(page, 'c432');

  const baseline = await page.evaluate(() => ({
    nodes: window.fpgaNodes.length,
    wires: window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]).sort((a,b) => a[0]-b[0])
  }));
  expect(baseline.wires).toHaveLength(354);

  await expect.poll(() => page.locator('#editorStage path.editor-wire').count(), { timeout: 180000 }).toBe(354);

  const result = await page.evaluate(() => {
    const audit = window.fpgaAuditRouteGeometry();
    const paths = [...document.querySelectorAll('#editorStage path.editor-wire')];
    const orthogonal = paths.every(path => {
      const nums = (path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (nums.length < 4 || nums.length % 2) return false;
      for (let i = 2; i < nums.length; i += 2) {
        if (Math.abs(nums[i] - nums[i-2]) > 0.001 && Math.abs(nums[i+1] - nums[i-1]) > 0.001) return false;
      }
      return true;
    });
    return {
      routeCount: paths.length,
      orthogonal,
      audit,
      connectivity: window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]).sort((a,b) => a[0]-b[0])
    };
  });

  expect(result.routeCount).toBe(354);
  expect(result.orthogonal).toBe(true);
  expect(result.connectivity).toEqual(baseline.wires);
  expect(result.audit.conflicts.filter(c => c.type === 'overlap' || c.type === 'block-penetration')).toEqual([]);
  console.log('LIBAVOID-C432 ' + JSON.stringify({
    blocks: baseline.nodes,
    routed: result.routeCount,
    orthogonal: result.orthogonal,
    crossings: result.audit.conflicts.filter(c => c.type === 'crossing').length,
    overlaps: result.audit.conflicts.filter(c => c.type === 'overlap').length,
    blockPenetrations: result.audit.conflicts.filter(c => c.type === 'block-penetration').length,
    logicalConnectivityPreserved: true
  }));
});
