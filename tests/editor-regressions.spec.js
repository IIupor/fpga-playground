const { test, expect } = require('@playwright/test');

async function loadS27(page) {
  await page.goto('/');
  await page.locator('#benchmarkSelect').evaluate(select => { select.value = 's27'; });
  await page.locator('#loadBenchmark').click();
  await expect(page.locator('#editorMessage')).toContainText('Loaded s27.v', { timeout: 30000 });
}

test('s27 benchmark button loads directly and preserves expected signal and symbol geometry', async ({ page }) => {
  await loadS27(page);
  const report = await page.evaluate(() => {
    const nodes = window.fpgaNodes;
    const wires = window.fpgaWires;
    const inverter = nodes.find(node => node.name === 'NOT_0');
    const dff = nodes.find(node => node.name === 'DFF_0');
    const group = id => document.querySelector(`#editorStage g[data-node="${id}"]`);
    const inverterGroup = group(inverter.id);
    const dffGroup = group(dff.id);
    const leadLines = [...inverterGroup.querySelectorAll('line.gate-symbol')].map(line => ({
      x1: Number(line.getAttribute('x1')), x2: Number(line.getAttribute('x2'))
    }));
    const marker = [...dffGroup.querySelectorAll('path.gate-symbol')]
      .map(path => path.getAttribute('d'))
      .find(d => /^M\s*18\s*[-\d.]+\s*l\s*7\s*5\s*-7\s*5$/.test(d || ''));
    const markerMatch = marker && /^M\s*18\s*([\d.-]+)\s*l\s*7\s*([\d.-]+)/.exec(marker);
    const dffHeight = Math.max(76, 50 + Math.max(dff.inputs, dff.outputs) * 22);
    const expectedClockY = (dffHeight - (dff.inputs - 1) * 22) / 2 + (dff.inputs > 1 ? 22 : 0);
    return {
      inverterValue: inverter.value,
      inverterOutput: inverter.outputNames?.[0],
      highOutgoingWires: wires.filter(wire => wire.from === inverter.id)
        .map(wire => document.querySelector(`path.editor-wire[data-wire="${wire.id}"]`)?.classList.contains('high')),
      leadLines,
      markerCenterY: markerMatch ? Number(markerMatch[1]) + Number(markerMatch[2]) : null,
      expectedClockY
    };
  });

  // G14 is !G0. With the benchmark's initial G0=0, green correctly means logic 1.
  expect(report.inverterOutput).toBe('G14');
  expect(report.inverterValue).toBe(1);
  expect(report.highOutgoingWires.every(Boolean)).toBe(true);
  expect(report.leadLines).toContainEqual({ x1: 0, x2: 18 });
  expect(report.leadLines).toContainEqual({ x1: 132, x2: 150 });
  expect(report.markerCenterY).toBe(report.expectedClockY);
});

test('clicking a block, its input pin, or a wire gives visible whole-object selection', async ({ page }) => {
  await loadS27(page);
  const nodeId = await page.evaluate(() => window.fpgaNodes.find(node => node.name === 'NOT_0').id);
  const group = page.locator(`#editorStage g[data-node="${nodeId}"]`);
  await group.click({ position: { x: 75, y: 47 } });
  await expect(group).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => group.locator('.gate-symbol').first().evaluate(el => getComputedStyle(el).stroke))
    .toBe('rgb(214, 139, 41)');

  await group.locator('.nodepin').first().click();
  await expect(page.locator(`#editorStage g[data-node="${nodeId}"]`)).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => page.locator(`#editorStage g[data-node="${nodeId}"] .nodepin`).first()
    .evaluate(el => getComputedStyle(el).fill)).toBe('rgb(214, 139, 41)');

  const target = await page.evaluate(() => {
    const svg = document.getElementById('editorStage');
    const paths = [...svg.querySelectorAll('path.editor-wire')];
    const parse = path => [...(path.getAttribute('d') || '').matchAll(/[ML]\s*(-?[\d.eE+]+)[,\s]+(-?[\d.eE+]+)/g)]
      .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
    const distance = (point, a, b) => {
      if (a.y === b.y) return Math.abs(point.y - a.y) + Math.max(0, Math.min(a.x, b.x) - point.x, point.x - Math.max(a.x, b.x));
      return Math.abs(point.x - a.x) + Math.max(0, Math.min(a.y, b.y) - point.y, point.y - Math.max(a.y, b.y));
    };
    for (const path of paths) {
      const points = parse(path);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (a.x === b.x && a.y === b.y) continue;
        const point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const clear = paths.filter(other => other !== path).every(other => {
          const p = parse(other);
          for (let j = 1; j < p.length; j++) if (distance(point, p[j - 1], p[j]) < 8) return false;
          return true;
        });
        if (!clear) continue;
        const screen = svg.createSVGPoint(); screen.x = point.x; screen.y = point.y;
        const transformed = screen.matrixTransform(path.getScreenCTM());
        return { id: path.dataset.wire, d: path.getAttribute('d'), x: transformed.x, y: transformed.y };
      }
    }
    return null;
  });
  expect(target, 'the benchmark should provide a selectable wire segment').not.toBeNull();
  await page.mouse.click(target.x, target.y);
  const selected = page.locator(`#editorStage path.editor-wire.selected[data-wire="${target.id}"]`);
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('d', target.d);
  const order = await selected.evaluate(el => [...el.parentNode.querySelectorAll('path.editor-wire')].at(-1) === el);
  expect(order, 'the complete selected net must be rendered above crossing wires').toBe(true);
});

test('built-in Verilog logic primitives display conventional positional terminal labels', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(() => {
    const source = `
      module primitive_labels(A, B, Y, Z);
        input A, B;
        output Y, Z;
        wire N;
        and U_AND(N, A, B);
        buf U_BUF(Y, N);
        not U_NOT(Z, B);
      endmodule
    `;
    const module = window.fpgaVerilogProject.parseVerilog(source, 'primitive-labels.v').get('primitive_labels');
    const graph = window.fpgaVerilogProject.graphFor(module, []);
    return graph.nodes.filter(node => ['U_AND', 'U_BUF', 'U_NOT'].includes(node.name))
      .map(node => ({ name: node.name, inputs: node.inputNames, outputs: node.outputPinLabels }));
  });
  expect(report).toEqual([
    { name: 'U_AND', inputs: ['A', 'B'], outputs: ['Y'] },
    { name: 'U_BUF', inputs: ['A'], outputs: ['Y'] },
    { name: 'U_NOT', inputs: ['A'], outputs: ['Y'] }
  ]);
});
