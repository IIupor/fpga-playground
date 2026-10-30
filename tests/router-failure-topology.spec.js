'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function loadBenchmark(page, name) {
  await page.route(\`https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/\${name}.v\`, async route => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', \`\${name}.v\`), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: source });
  });
  await page.goto('/');
  await page.locator('#benchmarkSelect').selectOption(name);
  await page.locator('#loadBenchmark').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 60000 });
}

function reasonFor(status) {
  return ({
    'blocked-endpoint': 'start or end point lies inside an obstacle',
    'state-limit': 'search reached maxStates before exhausting the queue',
    unroutable: 'search exhausted its reachable search space without reaching the target',
    routed: 'a route was found',
    'same-point': 'source and target coordinates are identical'
  })[status] || \`router returned status \${status}\`;
}

test('MT-FAILED-PRIMARY-01: capture endpoints, exact obstacles, failure reasons and retries for two failed first searches', async ({ page }) => {
  test.setTimeout(180000);
  await loadBenchmark(page, 'c432');
  await page.evaluate(() => {
    const mode = document.querySelector('#routingMode');
    if (mode) mode.value = 'mikami';
    if (typeof window.fpgaStartMikamiDiagnostic !== 'function') throw new Error('Mikami diagnostic runner missing');
    window.fpgaStartMikamiDiagnostic(20, 256);
  });

  let snapshot;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    snapshot = await page.evaluate(() => window.fpgaLastMikamiDiagnostic || null);
    if (snapshot?.status === 'completed' || snapshot?.status === 'error') break;
  }
  expect(snapshot?.status, snapshot?.error || '20-wire diagnostic must complete').toBe('completed');

  const report = await page.evaluate((searches) => {
    const nodes = window.fpgaNodes;
    const wires = window.fpgaWires;
    const width = n => ['INPUT', 'OUTPUT', 'VDD', 'GND'].includes(n.type) ? 112 : 150;
    const height = n => Math.max(76, 50 + Math.max(n.inputs, n.outputs) * 22);
    const boundsForNode = n => ({
      left: n.x - 8, right: n.x + width(n) + 8,
      top: n.y - 8, bottom: n.y + height(n) + 8
    });
    const pathByWire = new Map((window.fpgaLastMikamiDiagnostic.routePaths || []).map(r => [r.wireId, r.points]));
    const firstFailures = searches.filter(s => s.attempt === 1 && s.status !== 'routed').slice(0, 2);
    return firstFailures.map(first => {
      const wire = wires.find(w => w.id === first.wireId);
      const from = nodes.find(n => n.id === wire.from);
      const to = nodes.find(n => n.id === wire.to);
      const pinPoint = (n, side, index) => ({
        x: n.x + (side === 'out' ? width(n) : 0),
        y: n.y + 30 + index * 22
      });
      const blockObstacles = nodes
        .filter(n => n.id !== from.id && n.id !== to.id)
        .map(n => ({ kind: 'block', nodeId: n.id, nodeType: n.type, name: n.name, ...boundsForNode(n) }));
      const previousWireObstacles = [];
      for (const earlier of wires) {
        if (earlier.id === wire.id) break;
        if (earlier.from === wire.from) continue; // same-source branches are intentionally allowed to fan out
        const pts = pathByWire.get(earlier.id) || [];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          if (a.x === b.x && a.y === b.y) continue;
          const horizontal = a.y === b.y;
          previousWireObstacles.push({
            kind: 'previous-wire-segment', wireId: earlier.id,
            from: earlier.from, to: earlier.to,
            a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y },
            left: Math.min(a.x, b.x) - (horizontal ? 0 : 4),
            right: Math.max(a.x, b.x) + (horizontal ? 0 : 4),
            top: Math.min(a.y, b.y) - (horizontal ? 4 : 0),
            bottom: Math.max(a.y, b.y) + (horizontal ? 4 : 0)
          });
        }
      }
      const retry = searches.find(s => s.wireId === first.wireId && s.attempt === 2);
      return {
        wireId: wire.id,
        logicalEndpoints: { fromNodeId: wire.from, fromName: from.name, fromPin: wire.fromPin || 0,
          toNodeId: wire.to, toName: to.name, toPin: wire.toPin },
        coordinates: {
          start: pinPoint(from, 'out', wire.fromPin || 0),
          end: pinPoint(to, 'in', wire.toPin || 0)
        },
        primaryFailure: {
          status: first.status, reason: ({
            'blocked-endpoint': 'start or end lies inside an obstacle',
            'state-limit': 'maxStates was reached before the search queue was exhausted',
            unroutable: 'reachable search space was exhausted without reaching the target'
          })[first.status] || \`router status: \${first.status}\`,
          searchScope: first.searchScope,
          elapsedMs: first.elapsedMs,
          statesProcessed: first.statesProcessed,
          maxQueueLength: first.maxQueueLength,
          raySteps: first.raySteps,
          obstacleCountReportedByRouter: first.obstacleCount,
          obstacleChecks: first.obstacleChecks
        },
        obstacles: { blockCount: blockObstacles.length, previousWireSegmentCount: previousWireObstacles.length,
          blocks: blockObstacles, previousWireSegments: previousWireObstacles },
        retry: retry ? {
          status: retry.status,
          reason: retry.status === 'routed' ? 'route found after removing prior-wire keep-outs' :
            (({ 'blocked-endpoint': 'endpoint blocked by a block obstacle', 'state-limit': 'state limit reached', unroutable: 'still no route in block-only search' })[retry.status] || retry.status),
          searchScope: retry.searchScope,
          elapsedMs: retry.elapsedMs,
          statesProcessed: retry.statesProcessed,
          obstacleCountReportedByRouter: retry.obstacleCount,
          routePoints: pathByWire.get(wire.id) || []
        } : null
      };
    });
  }, snapshot.searches);

  expect(report, 'the first 20 c432 wires should reproduce two failed primary searches').toHaveLength(2);
  for (const item of report) {
    expect(item.primaryFailure.status).not.toBe('routed');
    expect(item.retry, \`wire \${item.wireId} should have a retry record\`).not.toBeNull();
    expect(item.retry.status, \`wire \${item.wireId} retry should route\`).toBe('routed');
    expect(item.obstacles.blocks.length).toBe(item.obstacles.blockCount);
    expect(item.obstacles.previousWireSegments.length).toBe(item.obstacles.previousWireSegmentCount);
    expect(item.coordinates.start.x).not.toBeNaN();
    expect(item.coordinates.end.y).not.toBeNaN();
  }
  console.log('MT-FAILED-PRIMARY-DETAILS ' + JSON.stringify(report));
});

test('TOPOLOGY-GEOMETRY-01: changing SVG wire geometry cannot alter connectivity or simulated outputs', async ({ page }) => {
  await loadBenchmark(page, 'c17');
  const before = await page.evaluate(() => {
    if (typeof window.fpgaEvaluateCircuit !== 'function') throw new Error('Logical evaluator test hook missing');
    const nodes = window.fpgaNodes, wires = window.fpgaWires;
    const inputs = nodes.filter(n => n.type === 'INPUT').sort((a, b) => a.name.localeCompare(b.name));
    const outputs = nodes.filter(n => n.type === 'OUTPUT').sort((a, b) => a.name.localeCompare(b.name));
    const signature = () => wires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin].join(':')).sort();
    const evaluateTruthTable = () => {
      const rows = [];
      for (let mask = 0; mask < (1 << inputs.length); mask++) {
        inputs.forEach((n, i) => { n.value = (mask >> i) & 1; });
        const evaluated = window.fpgaEvaluateCircuit();
        const byId = new Map(evaluated.map(n => [n.id, n]));
        rows.push({ input: inputs.map(n => n.value), output: outputs.map(n => byId.get(n.id).value) });
      }
      return rows;
    };
    const originalSignature = signature();
    const baseline = evaluateTruthTable();
    const candidates = wires.flatMap(a => wires.filter(b =>
      a.id < b.id && a.from !== b.from && a.from !== b.to && a.to !== b.from && a.to !== b.to
    ).map(b => [a, b]));
    if (!candidates.length) throw new Error('Could not find two wires with distinct endpoints');
    const [a, b] = candidates[0];
    const pathA = document.querySelector(\`path.editor-wire[data-wire="\${a.id}"]\`);
    const pathB = document.querySelector(\`path.editor-wire[data-wire="\${b.id}"]\`);
    if (!pathA || !pathB) throw new Error('Could not find SVG paths for selected independent wire segments');
    // Force an obvious geometric crossing in SVG only. The logical wire records are untouched.
    pathA.setAttribute('d', 'M 100 100 L 200 100');
    pathB.setAttribute('d', 'M 150 50 L 150 150');
    return { signature: originalSignature, baseline, selectedWires: [a.id, b.id],
      mutatedGeometry: [pathA.getAttribute('d'), pathB.getAttribute('d')],
      nodes: nodes.map(n => ({ id: n.id, type: n.type, name: n.name })) };
  });

  const after = await page.evaluate(() => {
    const inputs = window.fpgaNodes.filter(n => n.type === 'INPUT').sort((a, b) => a.name.localeCompare(b.name));
    const outputs = window.fpgaNodes.filter(n => n.type === 'OUTPUT').sort((a, b) => a.name.localeCompare(b.name));
    const wires = window.fpgaWires;
    const signature = wires.map(w => [w.id, w.from, w.fromPin || 0, w.to, w.toPin].join(':')).sort();
    const rows = [];
    for (let mask = 0; mask < (1 << inputs.length); mask++) {
      inputs.forEach((n, i) => { n.value = (mask >> i) & 1; });
      const evaluated = window.fpgaEvaluateCircuit();
      const byId = new Map(evaluated.map(n => [n.id, n]));
      rows.push({ input: inputs.map(n => n.value), output: outputs.map(n => byId.get(n.id).value) });
    }
    const p1 = document.querySelector(\`path.editor-wire[data-wire="\${\${0}}"]\`);
    return { signature, rows, pathA: document.querySelector(\`path.editor-wire[data-wire="\${window.__unusedWireA || ''}"]\`)?.getAttribute('d') };
  });

  expect(before.mutatedGeometry).toEqual(['M 100 100 L 200 100', 'M 150 50 L 150 150']);
  expect(before.signature).toEqual(after.signature);
  expect(after.rows).toEqual(before.baseline);
  expect(before.nodes.length).toBeGreaterThan(0);
  console.log('TOPOLOGY-GEOMETRY-REGRESSION ' + JSON.stringify({
    nodeCount: before.nodes.length, wireCount: before.signature.length,
    truthVectors: before.baseline.length, geometryMutated: before.mutatedGeometry,
    logicalConnectivityUnchanged: true, outputsUnchanged: true
  }));
});
