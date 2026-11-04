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
  await group.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  await expect(group).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => group.locator('.gate-symbol').first().evaluate(el => getComputedStyle(el).stroke))
    .toBe('rgb(214, 139, 41)');

  await group.locator('.nodepin').first().evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  await expect(page.locator(`#editorStage g[data-node="${nodeId}"]`)).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => page.locator(`#editorStage g[data-node="${nodeId}"] .nodepin`).first()
    .evaluate(el => getComputedStyle(el).fill)).toBe('rgb(214, 139, 41)');

  const target = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('#editorStage path.editor-wire')];
    const parse = path => [...(path.getAttribute('d') || '').matchAll(/[ML]\\s*(-?[\\d.eE+]+)[,\\s]+(-?[\\d.eE+]+)/g)]
      .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
    const crosses = (a, b, c, d) =>
      (a.y === b.y && c.x === d.x && c.x > Math.min(a.x, b.x) && c.x < Math.max(a.x, b.x) &&
        a.y > Math.min(c.y, d.y) && a.y < Math.max(c.y, d.y)) ||
      (a.x === b.x && c.y === d.y && a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x) &&
        c.y > Math.min(a.y, b.y) && c.y < Math.max(a.y, b.y));
    for (const path of paths) {
      const points = parse(path);
      let crossings = 0;
      for (const other of paths) if (other !== path) {
        const otherPoints = parse(other);
        for (let i = 1; i < points.length; i++) for (let j = 1; j < otherPoints.length; j++)
          if (crosses(points[i - 1], points[i], otherPoints[j - 1], otherPoints[j])) crossings++;
      }
      if (crossings) return { id: path.dataset.wire, d: path.getAttribute('d'), crossings };
    }
    return null;
  });
  expect(target, 'the benchmark should provide a wire that crosses another net').not.toBeNull();
  expect(target.crossings).toBeGreaterThan(0);
  await page.locator(`#editorStage path.editor-wire[data-wire="${target.id}"]`)
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  const selected = page.locator(`#editorStage path.editor-wire.selected[data-wire="${target.id}"]`);
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('d', target.d);
  const order = await selected.evaluate(el => [...el.parentNode.querySelectorAll('path.editor-wire')].at(-1) === el);
  expect(order, 'the complete selected net must be rendered above crossing wires').toBe(true);
});

test('built-in Verilog primitives use the IEEE positional terminal order and readable display labels', async ({ page }) => {
  const source = `
    module primitive_labels(A, B, Y, Z, W, V);
      input A;
      input B;
      output Y;
      output Z;
      output W;
      output V;
      wire N;
      and U_AND(N, A, B);
      buf U_BUF(Y, N);
      not U_NOT(Z, B);
      buf U_BUF_MULTI(W, V, N);
    endmodule
  `;
  await page.goto('/');
  await page.locator('#verilogFile').setInputFiles({
    name: 'primitive-labels.v',
    mimeType: 'text/plain',
    buffer: Buffer.from(source)
  });
  await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project', { timeout: 30000 });
  const report = await page.evaluate(() => window.fpgaNodes
    .filter(node => ['U_AND', 'U_BUF', 'U_NOT', 'U_BUF_MULTI'].includes(node.name))
    .map(node => ({
      name: node.name, type: node.type, inputs: node.inputNames,
      outputs: node.outputPinLabels, outputCount: node.outputs,
      visibleInputs: [...document.querySelectorAll(`#editorStage g[data-node="${node.id}"] .custom-pin-label[data-side="in"]`)].map(el => el.textContent),
      visibleOutputs: [...document.querySelectorAll(`#editorStage g[data-node="${node.id}"] .custom-pin-label[data-side="out"]`)].map(el => el.textContent)
    })));
  expect(report).toEqual([
    { name: 'U_AND', type: 'AND', inputs: ['A', 'B'], outputs: ['Y'], outputCount: 1, visibleInputs: ['A', 'B'], visibleOutputs: ['Y'] },
    { name: 'U_BUF', type: 'BUF', inputs: ['A'], outputs: ['Y'], outputCount: 1, visibleInputs: ['A'], visibleOutputs: ['Y'] },
    { name: 'U_NOT', type: 'NOT', inputs: ['A'], outputs: ['Y'], outputCount: 1, visibleInputs: ['A'], visibleOutputs: ['Y'] },
    { name: 'U_BUF_MULTI', type: 'BUF', inputs: ['A'], outputs: ['Y1', 'Y2'], outputCount: 2, visibleInputs: ['A'], visibleOutputs: ['Y1', 'Y2'] }
  ]);  await page.locator('#exportVerilog').click();
  const exported = await page.locator('#verilogText').inputValue();
  expect(exported).toContain('buf U_BUF_MULTI (U_BUF_MULTI_out1, U_BUF_MULTI_out2, U_AND_out);');
});
