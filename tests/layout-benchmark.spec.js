const { test, expect } = require('@playwright/test');

const cases = [
  { name: 'c17', minNodes: 1 },
  { name: 'c432', minNodes: 100 },
  { name: 'c7552', minNodes: 1000 }
];

for (const circuit of cases) {
  test(`${circuit.name}: layered layout has no overlapping blocks and keeps wires`, async ({ page }) => {
    await page.goto('/');
    await page.locator('#benchmarkSelect').selectOption(circuit.name);
    await page.locator('#loadBenchmark').click();
    await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
    await expect(page.locator('#editorMessage')).toContainText('logic levels');

    const report = await page.locator('#editorStage').evaluate((svg) => {
      const groups = [...svg.querySelectorAll('g[data-node]')];
      const wires = [...svg.querySelectorAll('path.editor-wire')];
      const boxes = groups.map((g) => {
        const b = g.getBBox();
        // getBBox() returns local geometry and does not include the group's
        // translate(x y), so include the node transform for world coordinates.
        const transform = g.getAttribute('transform') || '';
        const match = transform.match(/translate\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)/);
        const tx = match ? Number(match[1]) : 0;
        const ty = match ? Number(match[2]) : 0;
        return {
          id: g.getAttribute('data-node'),
          x: b.x + tx, y: b.y + ty,
          right: b.x + tx + b.width, bottom: b.y + ty + b.height,
          width: b.width, height: b.height
        };
      });
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
          if (overlapX > 1 && overlapY > 1) {
            overlaps.push({ a: a.id, b: b.id, overlapX, overlapY });
            if (overlaps.length >= 20) break;
          }
        }
        if (overlaps.length >= 20) break;
      }
      const distinctColumns = new Set(boxes.map(b => Math.round(b.x))).size;
      return {
        nodes: boxes.length, wires: wires.length, overlaps,
        distinctColumns,
        minX: Math.min(...boxes.map(b => b.x)),
        maxX: Math.max(...boxes.map(b => b.right)),
        minY: Math.min(...boxes.map(b => b.y)),
        maxY: Math.max(...boxes.map(b => b.bottom)),
        missingGeometry: boxes.filter(b => !Number.isFinite(b.x + b.y + b.width + b.height) || b.width <= 0 || b.height <= 0).length
      };
    });

    expect(report.nodes, 'benchmark should import a substantial circuit').toBeGreaterThanOrEqual(circuit.minNodes);
    expect(report.wires, 'imported circuit should contain routed wires').toBeGreaterThan(0);
    expect(report.distinctColumns, 'layout should place nodes in multiple dependency columns').toBeGreaterThan(1);
    expect(report.missingGeometry, 'all blocks should have valid SVG geometry').toBe(0);
    expect(report.overlaps, 'blocks should not overlap: ' + JSON.stringify(report.overlaps)).toEqual([]);
  }, 120000);
}
