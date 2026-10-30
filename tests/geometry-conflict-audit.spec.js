'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function loadBenchmark(page, name) {
  await page.route(`https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/${name}.v`, async route => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', `${name}.v`), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: source });
  });
  await page.goto('/');
  await page.locator('#benchmarkSelect').selectOption(name);
  await page.locator('#loadBenchmark').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 60000 });
}

test('GEOMETRY-AUDIT-01: audit every routed wire for crossings, overlaps and block penetration', async ({ page }) => {
  test.setTimeout(180000);
  for (const benchmark of ['c17', 'c432']) {
    await loadBenchmark(page, benchmark);
    const report = await page.evaluate(() => {
      if (typeof window.fpgaAuditRouteGeometry !== 'function') throw new Error('Geometry audit hook missing');
      const audit = window.fpgaAuditRouteGeometry();
      const validTypes = new Set(['crossing', 'overlap', 'block-penetration']);
      for (const conflict of audit.conflicts) {
        if (!validTypes.has(conflict.type)) throw new Error('Unknown conflict type: ' + conflict.type);
        if (!Array.isArray(conflict.wireIds) || !conflict.wireIds.length) throw new Error('Conflict has no wire IDs');
        if (!conflict.coordinates || !Object.keys(conflict.coordinates).length) throw new Error('Conflict has no coordinates');
        if (conflict.type === 'block-penetration' && (!Number.isInteger(conflict.blockId) || !conflict.blockName))
          throw new Error('Block penetration record is missing block identity');
      }
      return audit;
    });
    expect(report.wireCount).toBeGreaterThan(0);
    expect(report.segmentCount).toBeGreaterThan(0);
    expect(report.conflictCount).toBe(report.conflicts.length);
    console.log('FPGA-GEOMETRY-AUDIT-RESULT ' + JSON.stringify({ benchmark, ...report }));
  }
});

test('GEOMETRY-TOPOLOGY-01: rerouting geometry leaves logical connectivity and simulation unchanged', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const baseline = await page.evaluate(() => {
    const nodes = window.fpgaNodes;
    const inputs = nodes.filter(n => n.type === 'INPUT').sort((a, b) => a.name.localeCompare(b.name));
    const outputs = nodes.filter(n => n.type === 'OUTPUT').sort((a, b) => a.name.localeCompare(b.name));
    const connectivity = window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]).sort((a, b) => a[0] - b[0]);
    const truth = [];
    for (let mask = 0; mask < (1 << inputs.length); mask++) {
      inputs.forEach((n, i) => { n.value = (mask >> i) & 1; });
      const evaluated = window.fpgaEvaluateCircuit();
      const byId = new Map(evaluated.map(n => [n.id, n]));
      truth.push({ input: inputs.map(n => n.value), output: outputs.map(n => byId.get(n.id).value) });
    }
    return { connectivity, truth };
  });

  const after = await page.evaluate(() => {
    const mode = document.querySelector('#routingMode');
    mode.value = 'mikami';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const nodes = window.fpgaNodes;
    const inputs = nodes.filter(n => n.type === 'INPUT').sort((a, b) => a.name.localeCompare(b.name));
    const outputs = nodes.filter(n => n.type === 'OUTPUT').sort((a, b) => a.name.localeCompare(b.name));
    const connectivity = window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]).sort((a, b) => a[0] - b[0]);
    const truth = [];
    for (let mask = 0; mask < (1 << inputs.length); mask++) {
      inputs.forEach((n, i) => { n.value = (mask >> i) & 1; });
      const evaluated = window.fpgaEvaluateCircuit();
      const byId = new Map(evaluated.map(n => [n.id, n]));
      truth.push({ input: inputs.map(n => n.value), output: outputs.map(n => byId.get(n.id).value) });
    }
    return { connectivity, truth, audit: window.fpgaLastGeometryAudit };
  });

  expect(after.connectivity).toEqual(baseline.connectivity);
  expect(after.truth).toEqual(baseline.truth);
  expect(after.audit).toBeTruthy();
  console.log('GEOMETRY-TOPOLOGY-REGRESSION ' + JSON.stringify({
    truthVectors: baseline.truth.length,
    wireCount: baseline.connectivity.length,
    logicalConnectivityUnchanged: true,
    outputsUnchanged: true,
    postRerouteConflicts: after.audit.conflictCount
  }));
});
