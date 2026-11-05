const { test, expect } = require('@playwright/test');

test('Timing menu opens STA constraints and exports the current schematic', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#staMenu')).toBeVisible();
  await page.locator('#staMenu [data-menu="timing"]').click();
  await expect(page.locator('#staMenu [data-popup="timing"]')).toBeVisible();
  await page.locator('#staOpen').click();
  await expect(page.locator('#staDialog')).toBeVisible();

  const design = await page.evaluate(() => window.fpgaStaBuildDesign());
  expect(design.top).toBe('fpga_playground');
  expect(design.verilog).toContain('module fpga_playground(');
  expect(design.verilog).toContain('(* keep = 1 *) wire');
  expect(design.verilog).toContain('module fpga_node_');
  expect(Object.keys(design.signalMap).length).toBeGreaterThan(0);
  expect(Object.keys(design.instanceMap).length).toBeGreaterThan(0);

  const sdc = await page.evaluate(() => window.fpgaStaBuildSdc());
  expect(sdc).toContain('create_clock -name core_clk -period 10');
  expect(sdc).toContain('set_output_delay');
});

test('STA UI reports invalid clock periods instead of submitting a job', async ({ page }) => {
  await page.goto('/');
  await page.locator('#staMenu [data-menu="timing"]').click();
  await page.locator('#staOpen').click();
  await page.locator('#staPeriod').fill('0');

  const result = await page.evaluate(() => {
    try { window.fpgaStaBuildSdc(); return null; }
    catch (error) { return error.message; }
  });
  expect(result).toContain('Invalid timing constraint: period');
});

test('Selecting a timing path highlights its schematic node and wire', async ({ page }) => {
  await page.goto('/');
  const mapped = await page.evaluate(() => {
    const wire = window.fpgaWires.find(item => {
      const node = window.fpgaNodes.find(candidate => candidate.id === item.from);
      return node && !['INPUT','OUTPUT','VDD','GND'].includes(node.type);
    });
    const source = window.fpgaNodes.find(node => node.id === wire.from);
    window.fpgaStaHighlightPath(
      { nets: ['mapped_output'], cells: [source.name] },
      { mapped_output: { nodeId: source.id, wireIds: [wire.id] } },
      { [source.name]: { nodeId: source.id, wireIds: [wire.id] } }
    );
    return { nodeId: source.id, wireId: wire.id };
  });

  await expect(page.locator('g[data-node="' + mapped.nodeId + '"]')).toHaveClass(/sta-path-node/);
  await expect(page.locator('.editor-wire[data-wire="' + mapped.wireId + '"]')).toHaveClass(/sta-critical/);

  await page.evaluate(() => window.fpgaStaClearHighlight());
  await expect(page.locator('g[data-node="' + mapped.nodeId + '"]')).not.toHaveClass(/sta-path-node/);
  await expect(page.locator('.editor-wire[data-wire="' + mapped.wireId + '"]')).not.toHaveClass(/sta-critical/);
});


test('STA explains when the Cloudflare Free daily quota is exhausted', async ({ page }) => {
  await page.goto('/');
  const message = await page.evaluate(() =>
    window.fpgaStaBrokerErrorMessage(429, JSON.stringify({
      code: 'FREE_TIER_LIMIT',
      error: 'Cloudflare Free usage limit reached.'
    }))
  );
  expect(message).toContain('quota resets');
  expect(message).toContain('No paid plan is enabled');
});

test('STA explains Cloudflare edge quota errors even when the response is not JSON', async ({ page }) => {
  await page.goto('/');
  const message = await page.evaluate(() =>
    window.fpgaStaBrokerErrorMessage(429, '<html>Cloudflare error 1027: daily request limit exceeded</html>')
  );
  expect(message).toContain('quota resets');
  expect(message).toContain('No paid plan is enabled');
});
