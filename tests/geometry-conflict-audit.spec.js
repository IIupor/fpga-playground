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


test('GEOMETRY-SYNTHETIC-03: a real T-junction is one electrical net, not a conflict', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const audit = await page.evaluate(() => {
    const nodes = [
      { id: 301, type: 'INPUT', name: 'LEFT', x: 0, y: 0 },
      { id: 302, type: 'AND', name: 'JUNCTION', x: 0, y: 0, inputs: 2, outputs: 1 },
      { id: 303, type: 'OUTPUT', name: 'RIGHT', x: 0, y: 0 },
      { id: 304, type: 'OUTPUT', name: 'BRANCH', x: 0, y: 0 }
    ];
    const wires = [
      { id: 311, from: 301, to: 302 },
      { id: 312, from: 302, to: 303 },
      { id: 313, from: 302, to: 304 }
    ];
    const routes = new Map([
      [311, [{ x: -20, y: 0 }, { x: 0, y: 0 }]],
      [312, [{ x: 0, y: 0 }, { x: 20, y: 0 }]],
      [313, [{ x: 0, y: 0 }, { x: 0, y: 20 }]]
    ]);
    return window.fpgaAuditRouteGeometry({ nodes, wires, routes });
  });
  expect(audit.conflicts).toHaveLength(0);
  console.log('GEOMETRY-REAL-T-JUNCTION ' + JSON.stringify({ conflicts: audit.conflictCount, electricalNetPreserved: true }));
});

test('GEOMETRY-SYNTHETIC-04: an unconnected T-touch is reported as a geometric crossing', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const audit = await page.evaluate(() => {
    const nodes = [
      { id: 321, type: 'INPUT', name: 'H1', x: 0, y: 0 },
      { id: 322, type: 'OUTPUT', name: 'H2', x: 0, y: 0 },
      { id: 323, type: 'INPUT', name: 'V1', x: 0, y: 0 },
      { id: 324, type: 'OUTPUT', name: 'V2', x: 0, y: 0 }
    ];
    const wires = [{ id: 331, from: 321, to: 322 }, { id: 332, from: 323, to: 324 }];
    const routes = new Map([
      [331, [{ x: -20, y: 0 }, { x: 20, y: 0 }]],
      [332, [{ x: 0, y: 0 }, { x: 0, y: 20 }]]
    ]);
    return window.fpgaAuditRouteGeometry({ nodes, wires, routes });
  });
  const crossings = audit.conflicts.filter(c => c.type === 'crossing');
  expect(crossings).toHaveLength(1);
  expect(crossings[0].wireIds.sort((a,b) => a-b)).toEqual([331, 332]);
  expect(crossings[0].coordinates).toEqual({ x: 0, y: 0 });
  console.log('GEOMETRY-UNCONNECTED-T-TOUCH ' + JSON.stringify({ crossings: crossings.length, coordinate: crossings[0].coordinates, netsRemainSeparate: true }));
});

test('GEOMETRY-SYNTHETIC-05: unrelated wires touching at a shared endpoint remain separate', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const audit = await page.evaluate(() => {
    const nodes = [
      { id: 341, type: 'INPUT', name: 'A', x: 0, y: 0 },
      { id: 342, type: 'OUTPUT', name: 'B', x: 0, y: 0 },
      { id: 343, type: 'INPUT', name: 'C', x: 0, y: 0 },
      { id: 344, type: 'OUTPUT', name: 'D', x: 0, y: 0 }
    ];
    const wires = [{ id: 351, from: 341, to: 342 }, { id: 352, from: 343, to: 344 }];
    const routes = new Map([
      [351, [{ x: -10, y: 0 }, { x: 0, y: 0 }]],
      [352, [{ x: 0, y: 0 }, { x: 0, y: 10 }]]
    ]);
    return window.fpgaAuditRouteGeometry({ nodes, wires, routes });
  });
  const crossings = audit.conflicts.filter(c => c.type === 'crossing');
  expect(crossings).toHaveLength(1);
  expect(crossings[0].coordinates).toEqual({ x: 0, y: 0 });
  console.log('GEOMETRY-SHARED-ENDPOINT ' + JSON.stringify({ crossings: crossings.length, coordinate: crossings[0].coordinates }));
});

test('GEOMETRY-SYNTHETIC-06: multiple crossings between the same wire pair are all recorded', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const audit = await page.evaluate(() => {
    const nodes = [
      { id: 361, type: 'INPUT', name: 'A', x: 0, y: 0 },
      { id: 362, type: 'OUTPUT', name: 'B', x: 0, y: 0 },
      { id: 363, type: 'INPUT', name: 'C', x: 0, y: 0 },
      { id: 364, type: 'OUTPUT', name: 'D', x: 0, y: 0 }
    ];
    const wires = [{ id: 371, from: 361, to: 362 }, { id: 372, from: 363, to: 364 }];
    const routes = new Map([
      [371, [{ x: -20, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: -20, y: 10 }]],
      [372, [{ x: 0, y: -20 }, { x: 0, y: 20 }]]
    ]);
    return window.fpgaAuditRouteGeometry({ nodes, wires, routes });
  });
  const crossings = audit.conflicts.filter(c => c.type === 'crossing' && c.wireIds.includes(371) && c.wireIds.includes(372));
  expect(crossings).toHaveLength(2);
  expect(crossings.map(c => c.coordinates).sort((a,b) => a.y-b.y)).toEqual([{ x: 0, y: -10 }, { x: 0, y: 10 }]);
  console.log('GEOMETRY-MULTIPLE-CROSSINGS ' + JSON.stringify({ crossings: crossings.length, coordinates: crossings.map(c => c.coordinates) }));
});

test('GEOMETRY-SYNTHETIC-07: a routed wire through a block body is reported with block identity', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const audit = await page.evaluate(() => {
    const nodes = [
      { id: 381, type: 'INPUT', name: 'SOURCE', x: -200, y: -200, inputs: 0, outputs: 1 },
      { id: 382, type: 'AND', name: 'OBSTACLE', x: 0, y: 0, inputs: 2, outputs: 1 },
      { id: 383, type: 'OUTPUT', name: 'SINK', x: 200, y: 200, inputs: 1, outputs: 0 }
    ];
    const wires = [{ id: 391, from: 381, to: 383 }];
    const routes = new Map([[391, [{ x: -20, y: 40 }, { x: 180, y: 40 }]]]);
    return window.fpgaAuditRouteGeometry({ nodes, wires, routes });
  });
  const hits = audit.conflicts.filter(c => c.type === 'block-penetration');
  expect(hits).toHaveLength(1);
  expect(hits[0].wireIds).toEqual([391]);
  expect(hits[0].blockId).toBe(382);
  expect(hits[0].blockName).toBe('OBSTACLE');
  console.log('GEOMETRY-BLOCK-PENETRATION ' + JSON.stringify({ penetrations: hits.length, wireId: 391, blockId: 382 }));
});

test('GEOMETRY-C17-STRESS-01: c17 remains conflict-free across both routers and repeated Mikami reroutes', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const result = await page.evaluate(() => {
    const mode = document.querySelector('#routingMode');
    const capture = label => {
      const audit = window.fpgaLastGeometryAudit;
      const paths = [...document.querySelectorAll('path.editor-wire')];
      const routeSignature = paths.map(path => [Number(path.dataset.wire), path.getAttribute('d')]).sort((a,b) => a[0]-b[0]);
      const orthogonal = paths.every(path => {
        const values = (path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        if (values.length < 4 || values.length % 2) return false;
        for (let i=2;i<values.length;i+=2) {
          const dx=Math.abs(values[i]-values[i-2]),dy=Math.abs(values[i+1]-values[i-1]);
          if (dx>0.001 && dy>0.001) return false;
        }
        return true;
      });
      return { label, audit, pathCount: paths.length, orthogonal, routeSignature };
    };
    const snapshots = [];
    for (const selectedMode of ['legacy','mikami','mikami']) {
      mode.value=selectedMode;
      mode.dispatchEvent(new Event('change',{bubbles:true}));
      snapshots.push(capture(selectedMode+'-'+snapshots.length));
    }
    const wires = window.fpgaWires.map(w=>[w.id,w.from,w.fromPin||0,w.to,w.toPin]).sort((a,b)=>a[0]-b[0]);
    return { snapshots, wires };
  });
  for (const snapshot of result.snapshots) {
    expect(snapshot.pathCount).toBe(14);
    expect(snapshot.orthogonal).toBe(true);
    expect(snapshot.audit.conflictCount).toBe(0);
    expect(snapshot.audit.wireCount).toBe(14);
  }
  expect(result.snapshots[1].routeSignature).toEqual(result.snapshots[2].routeSignature);
  expect(result.wires).toHaveLength(14);
  console.log('GEOMETRY-C17-ROUTER-STRESS ' + JSON.stringify({
    modes: result.snapshots.map(s=>s.label),
    conflicts: result.snapshots.map(s=>s.audit.conflictCount),
    orthogonalRoutes: result.snapshots.every(s=>s.orthogonal),
    repeatedMikamiDeterministic: JSON.stringify(result.snapshots[1].routeSignature)===JSON.stringify(result.snapshots[2].routeSignature),
    wireCount: result.wires.length
  }));
});


test('GEOMETRY-C17-ORDER-STRESS-01: Mikami routing stays valid under different wire processing orders', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const result = await page.evaluate(() => {
    const original = window.fpgaWires.slice();
    const permutations = [
      ['original', original.slice()],
      ['reverse', original.slice().reverse()],
      ['rotate-5', original.slice(5).concat(original.slice(0, 5))],
      ['even-odd', original.filter((_, i) => i % 2 === 0).concat(original.filter((_, i) => i % 2 === 1))],
      ['odd-even-reverse', original.filter((_, i) => i % 2 === 1).reverse().concat(original.filter((_, i) => i % 2 === 0).reverse())]
    ];
    const capture = label => {
      const paths = [...document.querySelectorAll('path.editor-wire')];
      const signature = paths.map(p => [Number(p.dataset.wire), p.getAttribute('d')]).sort((a,b) => a[0]-b[0]);
      const orthogonal = paths.every(path => {
        const values = (path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        if (values.length < 4 || values.length % 2) return false;
        for (let i=2;i<values.length;i+=2) {
          if (Math.abs(values[i]-values[i-2]) > 0.001 && Math.abs(values[i+1]-values[i-1]) > 0.001) return false;
        }
        return true;
      });
      return {
        label,
        audit: window.fpgaLastGeometryAudit,
        pathCount: paths.length,
        orthogonal,
        signature
      };
    };
    const mode = document.querySelector('#routingMode');
    mode.value = 'mikami';
    const snapshots = [];
    try {
      for (const [label, order] of permutations) {
        window.fpgaWires.splice(0, window.fpgaWires.length, ...order);
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        const first = capture(label);
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        const repeated = capture(label + '-repeat');
        snapshots.push({ ...first, deterministic: JSON.stringify(first.signature) === JSON.stringify(repeated.signature) });
      }
    } finally {
      window.fpgaWires.splice(0, window.fpgaWires.length, ...original);
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return {
      snapshots,
      restoredWireOrder: window.fpgaWires.map(w => w.id).join(',') === original.map(w => w.id).join(',')
    };
  });
  expect(result.snapshots).toHaveLength(5);
  for (const snapshot of result.snapshots) {
    expect(snapshot.pathCount).toBe(14);
    expect(snapshot.orthogonal).toBe(true);
    expect(snapshot.audit.conflictCount).toBe(0);
    expect(snapshot.audit.wireCount).toBe(14);
    expect(snapshot.deterministic).toBe(true);
  }
  expect(result.restoredWireOrder).toBe(true);
  console.log('GEOMETRY-C17-WIRE-ORDER-STRESS ' + JSON.stringify({
    permutations: result.snapshots.map(s => s.label),
    conflicts: result.snapshots.map(s => s.audit.conflictCount),
    orthogonal: result.snapshots.every(s => s.orthogonal),
    deterministicPerOrder: result.snapshots.every(s => s.deterministic),
    wireOrderRestored: result.restoredWireOrder
  }));
});


test('GEOMETRY-C432-ORDER-STRESS-01: Mikami routing stays valid under different c432 wire processing orders', async ({ page }) => {
  test.setTimeout(300000);
  await loadBenchmark(page, 'c432');
  const result = await page.evaluate(() => {
    const original = window.fpgaWires.slice();
    const permutations = [
      ['original', original.slice()],
      ['reverse', original.slice().reverse()],
      ['rotate-89', original.slice(89).concat(original.slice(0, 89))]
    ];
    const mode = document.querySelector('#routingMode');
    mode.value = 'mikami';
    const snapshots = [];
    const capture = label => {
      const paths = [...document.querySelectorAll('path.editor-wire')];
      const orthogonal = paths.every(path => {
        const values = (path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        if (values.length < 4 || values.length % 2) return false;
        for (let i = 2; i < values.length; i += 2) {
          if (Math.abs(values[i] - values[i - 2]) > 0.001 &&
              Math.abs(values[i + 1] - values[i - 1]) > 0.001) return false;
        }
        return true;
      });
      return {
        label,
        audit: window.fpgaLastGeometryAudit,
        pathCount: paths.length,
        orthogonal,
        signature: paths.map(p => [Number(p.dataset.wire), p.getAttribute('d')]).sort((a,b) => a[0]-b[0])
      };
    };
    try {
      for (const [label, order] of permutations) {
        window.fpgaWires.splice(0, window.fpgaWires.length, ...order);
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        const first = capture(label);
        mode.dispatchEvent(new Event('change', { bubbles: true }));
        const repeated = capture(label + '-repeat');
        snapshots.push({
          ...first,
          deterministic: JSON.stringify(first.signature) === JSON.stringify(repeated.signature)
        });
      }
    } finally {
      window.fpgaWires.splice(0, window.fpgaWires.length, ...original);
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return {
      snapshots,
      wireCount: original.length,
      restoredWireOrder: window.fpgaWires.map(w => w.id).join(',') === original.map(w => w.id).join(',')
    };
  });
  expect(result.wireCount).toBe(354);
  expect(result.snapshots).toHaveLength(3);
  for (const snapshot of result.snapshots) {
    expect(snapshot.pathCount).toBe(354);
    expect(snapshot.orthogonal).toBe(true);
    expect(snapshot.audit.conflictCount).toBe(0);
    expect(snapshot.audit.wireCount).toBe(354);
    expect(snapshot.deterministic).toBe(true);
  }
  expect(result.restoredWireOrder).toBe(true);
  console.log('GEOMETRY-C432-WIRE-ORDER-STRESS ' + JSON.stringify({
    permutations: result.snapshots.map(s => s.label),
    conflicts: result.snapshots.map(s => s.audit.conflictCount),
    orthogonal: result.snapshots.every(s => s.orthogonal),
    deterministicPerOrder: result.snapshots.every(s => s.deterministic),
    pathCounts: result.snapshots.map(s => s.pathCount),
    wireOrderRestored: result.restoredWireOrder
  }));
});
