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
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
}

test('MT-DIAG-01: profile the first 20 c432 nets with yielding progress', async ({ page }) => {
  test.setTimeout(300000);
  await loadBenchmark(page, 'c432');

  await page.evaluate(() => {
    if (typeof window.fpgaStartMikamiDiagnostic !== 'function') {
      throw new Error('Mikami diagnostic runner was not installed');
    }
    window.fpgaStartMikamiDiagnostic(20);
  });

  let lastCompleted = -1;
  let snapshot;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    snapshot = await page.evaluate(() => window.fpgaLastMikamiDiagnostic || null);
    if (!snapshot) continue;
    if (snapshot.completed !== lastCompleted) {
      lastCompleted = snapshot.completed;
      console.log(`MT-DIAG-PROGRESS c432: ${JSON.stringify({
        completed: snapshot.completed, total: snapshot.total,
        elapsedMs: Number(snapshot.elapsedMs.toFixed(1)),
        searchCount: snapshot.searchCount,
        routedSearches: snapshot.routedSearches,
        failedSearches: snapshot.failedSearches,
        totalStatesProcessed: snapshot.totalStatesProcessed,
        totalRaySteps: snapshot.totalRaySteps,
        totalObstacleChecks: snapshot.totalObstacleChecks,
        lastWire: snapshot.lastWire
      })}`);
    }
    if (snapshot.status === 'completed' || snapshot.status === 'error') break;
  }

  expect(snapshot, 'diagnostic should publish progress').not.toBeNull();
  expect(snapshot.status, snapshot.error || 'diagnostic should complete').toBe('completed');
  expect(snapshot.completed).toBe(20);
  expect(snapshot.searchCount).toBeGreaterThanOrEqual(20);
  console.log(`MT-DIAG-RESULT c432: ${JSON.stringify({
    wireCount: snapshot.wireCount, completed: snapshot.completed,
    elapsedMs: Number(snapshot.elapsedMs.toFixed(1)),
    searchCount: snapshot.searchCount, retryCount: snapshot.retryCount,
    routedSearches: snapshot.routedSearches, failedSearches: snapshot.failedSearches,
    totalStatesProcessed: snapshot.totalStatesProcessed,
    totalRaySteps: snapshot.totalRaySteps,
    totalObstacleChecks: snapshot.totalObstacleChecks,
    slowestSearchMs: Number(snapshot.slowestSearchMs.toFixed(1)),
    slowestSearches: snapshot.searches.slice().sort((a,b) => b.searchTimeMs-a.searchTimeMs).slice(0,5)
  })}`);
});
