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


test('Verilog editor shows synchronized line numbers', async ({ page }) => {
  await page.goto('/');
  await page.locator('#verilogText').fill('module demo(input wire a, output wire y);\nassign y = a;\nendmodule');
  await expect(page.locator('#verilogLineNumbers')).toHaveText('1\n2\n3');
});

test('GitHub sign-in popup preserves the STA dialog and updates the account button', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fpgaStaBrokerUrl', 'https://sta-broker.test');
  });
  await page.route('https://sta-broker.test/auth/login', async route => {
    const returnUrl = page.url().split('#')[0] + '#sta_session=test-session-id';
    await route.fulfill({status: 302, headers: {location: returnUrl}});
  });
  await page.route('https://sta-broker.test/api/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({authenticated: true, login: 'vas.khvatov'})
  }));
  await page.goto('/');
  await page.locator('#staMenu [data-menu="timing"]').click();
  await page.locator('#staOpen').click();
  const nodesBefore = await page.locator('#editorStage g[data-node]').count();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#staLogin').click();
  const popup = await popupPromise;
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#staDialog')).toBeVisible();
  await expect(page.locator('#staAuthStatus')).toContainText('Signed in as vas.khvatov');
  await expect(page.locator('#staLogin')).toHaveText('Signed in as vas.khvatov');
  await expect(page.locator('#staLogin')).toBeDisabled();
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(nodesBefore);
});

test('STA result can open synthesized Yosys Verilog in the editor', async ({ page }) => {
  const mappedVerilog = 'module mapped_top(input wire a, output wire y);\n  sky130_fd_sc_hd__buf_1 U1 (.A(a), .X(y));\nendmodule\n';
  await page.addInitScript(() => {
    localStorage.setItem('fpgaStaBrokerUrl', 'https://sta-broker.test');
    sessionStorage.setItem('fpgaStaSession', 'test-session-id');
  });
  await page.route('https://sta-broker.test/api/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({authenticated: true, login: 'vas.khvatov'})
  }));
  await page.route('https://sta-broker.test/api/jobs', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({status: 202, contentType: 'application/json', body: JSON.stringify({jobId: '00000000-0000-4000-8000-000000000001'})});
    } else {
      await route.continue();
    }
  });
  await page.route('https://sta-broker.test/api/jobs/00000000-0000-4000-8000-000000000001', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'completed',
      result: {
        status: 'completed',
        flow_mode: 'rtl_synthesized',
        summary: {flow_mode: 'rtl_synthesized', setup_wns: 0, setup_tns: 0, setup_path_count: 0, hold_path_count: 0},
        setup_paths: [],
        hold_paths: [],
        report: 'Synthetic test report',
        mapped_verilog: mappedVerilog
      }
    })
  }));
  await page.goto('/');
  await page.locator('#staMenu [data-menu="timing"]').click();
  await page.locator('#staOpen').click();
  await page.locator('#staRun').click();
  await expect(page.locator('#staOpenYosysVerilog')).toBeVisible();
  await page.locator('#staOpenYosysVerilog').click();
  await expect(page.locator('#verilogText')).toHaveValue(mappedVerilog);
  await expect(page.locator('#editorMessage')).toContainText('technology-mapped Verilog');
  await expect(page.locator('#staDialog')).toBeVisible();
});
