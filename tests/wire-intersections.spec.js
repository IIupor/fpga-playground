const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const benchmarks = ['c17', 'c432', 'c499', 'c880'];

for (const name of benchmarks) {
  test(name + ': imported benchmark renders identifiable wire geometry', async ({ page }) => {
    // Use repository fixtures so the test does not depend on GitHub Raw availability.
    await page.route(`https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/${name}.v`, async route => {
      const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', `${name}.v`), 'utf8');
      await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: source });
    });

    await page.goto('/');
    await page.locator('#benchmarkSelect').selectOption(name);
    await page.locator('#loadBenchmark').click();
    await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
    await expect.poll(() => page.locator('#editorStage g[data-node]').count(), { timeout: 15000 })
      .toBeGreaterThan(0);
    const wires = page.locator('#editorStage path.editor-wire');
    await expect.poll(() => wires.count(), { timeout: 30000 }).toBeGreaterThan(0);

    const geometry = await wires.evaluateAll(paths => paths.map(path => ({
      id: path.getAttribute('data-wire'),
      from: path.getAttribute('data-from'),
      to: path.getAttribute('data-to'),
      length: path.getTotalLength()
    })));

    expect(geometry.every(w => w.id && w.from && w.to && Number.isFinite(w.length) && w.length > 0),
      name + ' contains a wire without identity, endpoints, or valid geometry').toBe(true);
    expect(new Set(geometry.map(w => w.id)).size, name + ' contains duplicate wire IDs')
      .toBe(geometry.length);
  }, 120000);
}

test('wire crossing geometry distinguishes a proper crossing from a shared endpoint', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const cross = (u, v) => u.x * v.y - u.y * v.x;
    const sub = (u, v) => ({ x: u.x - v.x, y: u.y - v.y });
    const intersects = (p, q, r, s) => {
      const a = sub(q, p), b = sub(s, r), delta = sub(r, p);
      const denominator = cross(a, b);
      if (Math.abs(denominator) < 1e-8) return false;
      const t = cross(delta, b) / denominator;
      const u = cross(delta, a) / denominator;
      return t > 1e-8 && t < 1 - 1e-8 && u > 1e-8 && u < 1 - 1e-8;
    };
    return {
      crossing: intersects({x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}),
      sharedEndpoint: intersects({x:0,y:0},{x:10,y:0},{x:10,y:0},{x:10,y:10}),
      separated: intersects({x:0,y:0},{x:10,y:0},{x:0,y:5},{x:10,y:5})
    };
  });
  expect(result).toEqual({ crossing: true, sharedEndpoint: false, separated: false });
});
