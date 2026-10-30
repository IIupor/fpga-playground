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

test('MT-C432-FULL-01: profile all c432 wires at spatial cell size 256', async ({ page }) => {
  test.setTimeout(900000);
  await loadBenchmark(page, 'c432');
  await page.evaluate(() => {
    const mode = document.querySelector('#routingMode');
    if (mode) mode.value = 'mikami';
  });

  await page.evaluate(() => {
    if (typeof window.fpgaStartMikamiDiagnostic !== 'function') throw new Error('MT diagnostic runner missing');
    window.fpgaStartMikamiDiagnostic(354, 256);
  });

  let snapshot;
  const deadline = Date.now() + 840000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    snapshot = await page.evaluate(() => window.fpgaLastMikamiDiagnostic || null);
    if (snapshot?.status === 'completed' || snapshot?.status === 'error') break;
  }
  expect(snapshot, 'full c432 diagnostic must publish progress').not.toBeNull();
  expect(snapshot.status, snapshot.error || 'full c432 diagnostic should complete').toBe('completed');
  expect(snapshot.completed).toBe(354);
  expect(snapshot.wireCount).toBe(354);

  const failedFirstAttempts = snapshot.searches.filter(s => s.attempt === 1 && s.status !== 'routed');
  const failedRetries = snapshot.searches.filter(s => s.attempt === 2 && s.status !== 'routed');
  const report = {
    cellSize: 256,
    elapsedMs: Number(snapshot.elapsedMs.toFixed(1)),
    wireCount: snapshot.wireCount,
    completed: snapshot.completed,
    searchCount: snapshot.searchCount,
    retryCount: snapshot.retryCount,
    routedSearches: snapshot.routedSearches,
    failedSearches: snapshot.failedSearches,
    totalStatesProcessed: snapshot.totalStatesProcessed,
    totalRaySteps: snapshot.totalRaySteps,
    totalObstacleChecks: snapshot.totalObstacleChecks,
    totalSpatialCandidateChecks: snapshot.totalSpatialCandidateChecks,
    totalExhaustiveEquivalentChecks: snapshot.totalExhaustiveEquivalentChecks,
    reductionFactor: Number((snapshot.totalExhaustiveEquivalentChecks / Math.max(1, snapshot.totalSpatialCandidateChecks)).toFixed(2)),
    slowestSearchMs: snapshot.slowestSearchMs,
    failedFirstAttempts: failedFirstAttempts.map(s => ({
      wireId: s.wireId, from: s.from, to: s.to, attempt: s.attempt, scope: s.searchScope,
      status: s.status, elapsedMs: s.elapsedMs, searchTimeMs: s.searchTimeMs,
      statesProcessed: s.statesProcessed, maxQueueLength: s.maxQueueLength,
      raySteps: s.raySteps, xLines: s.xLines, yLines: s.yLines,
      gridPointCount: s.gridPointCount, obstacleCount: s.obstacleCount,
      obstacleChecks: s.obstacleChecks, pointChecks: s.obstaclePointChecks,
      segmentChecks: s.obstacleSegmentChecks
    })),
    failedRetries: failedRetries.map(s => ({
      wireId: s.wireId, from: s.from, to: s.to, attempt: s.attempt, scope: s.searchScope,
      status: s.status, elapsedMs: s.elapsedMs, searchTimeMs: s.searchTimeMs,
      statesProcessed: s.statesProcessed, maxQueueLength: s.maxQueueLength,
      raySteps: s.raySteps, xLines: s.xLines, yLines: s.yLines,
      gridPointCount: s.gridPointCount, obstacleCount: s.obstacleCount,
      obstacleChecks: s.obstacleChecks
    })),
    slowestSearches: snapshot.searches.slice().sort((a,b) => (b.searchTimeMs || 0) - (a.searchTimeMs || 0)).slice(0, 10)
  };
  console.log('MT-C432-FULL-256 ' + JSON.stringify(report));
});

test('TOPOLOGY-01: geometric crossings do not create logical connectivity', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const result = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('#editorStage path.editor-wire')];
    const nodes = [...document.querySelectorAll('#editorStage g[data-node]')].map(g => Number(g.getAttribute('data-node')));
    const nodeSet = new Set(nodes);
    const wires = paths.map(p => ({
      id: p.getAttribute('data-wire'),
      from: Number(p.getAttribute('data-from')),
      to: Number(p.getAttribute('data-to')),
      d: p.getAttribute('d') || ''
    }));
    const ids = wires.map(w => w.id);
    const malformed = wires.filter(w => !w.id || !nodeSet.has(w.from) || !nodeSet.has(w.to) || !w.d);
    const endpointPairs = wires.map(w => [w.id, w.from, w.to].join(':'));
    const uniquePairs = new Set(endpointPairs);
    // Build logical connectivity only from explicit wire endpoints. SVG segment
    // intersections are deliberately not inserted as graph vertices/edges.
    const adjacency = new Map(nodes.map(id => [id, new Set()]));
    for (const w of wires) {
      adjacency.get(w.from)?.add(w.to);
      adjacency.get(w.to)?.add(w.from);
    }
    const components = [];
    const seen = new Set();
    for (const id of nodes) {
      if (seen.has(id)) continue;
      const stack = [id], component = [];
      seen.add(id);
      while (stack.length) {
        const current = stack.pop();
        component.push(current);
        for (const next of adjacency.get(current) || []) if (!seen.has(next)) {
          seen.add(next); stack.push(next);
        }
      }
      components.push(component);
    }
    return {
      nodeCount: nodes.length, wireCount: wires.length,
      duplicateWireIds: ids.length - new Set(ids).size,
      malformedWires: malformed,
      duplicateEndpointRecords: endpointPairs.length - uniquePairs.size,
      componentCount: components.length,
      wires
    };
  });
  console.log('TOPOLOGY-EXPLICIT-ENDPOINTS ' + JSON.stringify({ ...result, wires: undefined }));
  expect(result.nodeCount).toBeGreaterThan(0);
  expect(result.wireCount).toBeGreaterThan(0);
  expect(result.duplicateWireIds).toBe(0);
  expect(result.malformedWires).toEqual([]);
  expect(result.duplicateEndpointRecords).toBe(0);
});

test('C7552-PROFILE-01: identify which import/export phase exceeds the budget', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/');
  const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', 'c7552.v'), 'utf8');
  const phases = {};
  let t = Date.now();
  await page.locator('#verilogText').fill(source);
  phases.fillSourceMs = Date.now() - t;
  console.log('C7552-PHASE fillSource ' + phases.fillSourceMs + 'ms');

  t = Date.now();
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 180000 });
  phases.firstImportMs = Date.now() - t;
  phases.firstBlocks = await page.locator('#editorStage g[data-node]').count();
  phases.firstWires = await page.locator('#editorStage path.editor-wire').count();
  console.log('C7552-PHASE firstImport ' + JSON.stringify({ ms: phases.firstImportMs, blocks: phases.firstBlocks, wires: phases.firstWires }));

  t = Date.now();
  await page.locator('#exportVerilog').click();
  await expect(page.locator('#verilogText')).toHaveValue(/module fpga_playground/, { timeout: 180000 });
  const exported = await page.locator('#verilogText').inputValue();
  phases.exportMs = Date.now() - t;
  phases.exportedChars = exported.length;
  console.log('C7552-PHASE export ' + JSON.stringify({ ms: phases.exportMs, chars: phases.exportedChars }));

  t = Date.now();
  await page.locator('#verilogText').evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, exported);
  phases.setExportedTextMs = Date.now() - t;
  console.log('C7552-PHASE setExportedText ' + phases.setExportedTextMs + 'ms');

  t = Date.now();
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 180000 });
  phases.secondImportMs = Date.now() - t;
  phases.secondBlocks = await page.locator('#editorStage g[data-node]').count();
  phases.secondWires = await page.locator('#editorStage path.editor-wire').count();
  console.log('C7552-PHASE secondImport ' + JSON.stringify({ ms: phases.secondImportMs, blocks: phases.secondBlocks, wires: phases.secondWires }));
  console.log('C7552-PHASE-SUMMARY ' + JSON.stringify(phases));

  expect(phases.firstBlocks).toBeGreaterThan(0);
  expect(phases.firstWires).toBeGreaterThan(0);
  expect(phases.secondBlocks).toBe(phases.firstBlocks);
  expect(phases.secondWires).toBe(phases.firstWires);
});
