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
  expect(Object.keys(design.signalMap).length).toBeGreaterThan(0);

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
