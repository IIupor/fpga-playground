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

