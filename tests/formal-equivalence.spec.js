const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

test('c17: Yosys formally proves Verilog export equivalent', async ({ page }) => {
  await page.goto('/');
  const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', 'c17.v'), 'utf8');

  await page.locator('#verilogText').fill(source);
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported');

  await page.locator('#exportVerilog').click();
  const exported = await page.locator('#verilogText').inputValue();
  expect(exported).toContain('module fpga_playground');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c17-formal-'));
  try {
    const originalPath = path.join(dir, 'original.v');
    const exportedPath = path.join(dir, 'exported.v');
    const scriptPath = path.join(dir, 'prove.ys');
    fs.writeFileSync(originalPath, source);
    fs.writeFileSync(exportedPath, exported);

    // Match ports by name and prove every output bit equivalent. Unlike
    // simulation vectors, this asks the SAT engine to cover every input case.
    fs.writeFileSync(scriptPath, [
      `read_verilog ${originalPath} ${exportedPath}`,
      'rename c17 gold',
      'rename fpga_playground gate',
      'equiv_make gold gate equiv',
      'hierarchy -top equiv',
      'equiv_simple',
      'equiv_status -assert',
      ''
    ].join('\n'));

    const log = execFileSync('yosys', ['-Q', '-s', scriptPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000
    });
    expect(log).toContain('Equivalence successfully proven');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
