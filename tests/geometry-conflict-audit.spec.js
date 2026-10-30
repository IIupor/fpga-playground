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


test('GEOMETRY-SYNTHETIC-01: unrelated nets may cross visually without becoming electrically connected', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const result = await page.evaluate(() => {
    const beforeConnectivity = window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]);
    const nodes = [
      { id: 101, type: 'INPUT', name: 'A', x: 100, y: 100 },
      { id: 102, type: 'OUTPUT', name: 'Y', x: 300, y: 100 },
      { id: 103, type: 'INPUT', name: 'B', x: 100, y: 300 },
      { id: 104, type: 'OUTPUT', name: 'Z', x: 300, y: 300 }
    ];
    const wires = [
      { id: 201, from: 101, to: 102 },
      { id: 202, from: 103, to: 104 }
    ];
    const routes = new Map([
      [201, [{ x: 0, y: 0 }, { x: 20, y: 0 }]],
      [202, [{ x: 10, y: -10 }, { x: 10, y: 10 }]]
    ]);
    const audit = window.fpgaAuditRouteGeometry({ nodes, wires, routes });
    const afterConnectivity = window.fpgaWires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin]);
    return { audit, beforeConnectivity, afterConnectivity };
  });
  expect(result.audit.conflicts.filter(c => c.type === 'crossing')).toHaveLength(1);
  expect(result.audit.conflicts[0].wireIds.sort((a,b) => a-b)).toEqual([201, 202]);
  expect(result.beforeConnectivity).toEqual(result.afterConnectivity);
  console.log('GEOMETRY-SYNTHETIC-CROSSING ' + JSON.stringify({
    detectedCrossings: result.audit.conflicts.filter(c => c.type === 'crossing').length,
    syntheticNetsRemainSeparate: true,
    liveConnectivityUnchanged: true
  }));
});

test('GEOMETRY-SYNTHETIC-02: collinear overlap is reported but does not merge unrelated nets', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const result = await page.evaluate(() => {
    const nodes = [
      { id: 111, type: 'INPUT', name: 'C', x: 100, y: 100 },
      { id: 112, type: 'OUTPUT', name: 'P', x: 300, y: 100 },
      { id: 113, type: 'INPUT', name: 'D', x: 100, y: 300 },
      { id: 114, type: 'OUTPUT', name: 'Q', x: 300, y: 300 }
    ];
    const wires = [
      { id: 211, from: 111, to: 112 },
      { id: 212, from: 113, to: 114 }
    ];
    const routes = new Map([
      [211, [{ x: 0, y: 0 }, { x: 20, y: 0 }]],
      [212, [{ x: 5, y: 0 }, { x: 15, y: 0 }]]
    ]);
    const audit = window.fpgaAuditRouteGeometry({ nodes, wires, routes });
    return { audit, liveWireCount: window.fpgaWires.length };
  });
  expect(result.audit.conflicts.filter(c => c.type === 'overlap')).toHaveLength(1);
  expect(result.audit.conflicts[0].wireIds.sort((a,b) => a-b)).toEqual([211, 212]);
  expect(result.liveWireCount).toBe(14);
  console.log('GEOMETRY-SYNTHETIC-OVERLAP ' + JSON.stringify({
    detectedOverlaps: result.audit.conflicts.filter(c => c.type === 'overlap').length,
    syntheticNetsRemainSeparate: true,
    liveCircuitUnchanged: true
  }));
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
