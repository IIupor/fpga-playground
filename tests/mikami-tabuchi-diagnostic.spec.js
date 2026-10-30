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

test('MT-DIAG-01: measure c432 spatial cell sizes with identical routes', async ({ page }) => {
  test.setTimeout(300000);
  await loadBenchmark(page, 'c432');

  const measurements = [];
  for (const cellSize of [32, 64, 128, 256]) {
    await page.evaluate((size) => {
      if (typeof window.fpgaStartMikamiDiagnostic !== 'function') {
        throw new Error('Mikami diagnostic runner was not installed');
      }
      window.fpgaStartMikamiDiagnostic(20, size);
    }, cellSize);

    let snapshot;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      snapshot = await page.evaluate(() => window.fpgaLastMikamiDiagnostic || null);
      if (snapshot?.status === 'completed' || snapshot?.status === 'error') break;
    }

    expect(snapshot, `cell size ${cellSize}: diagnostic should publish progress`).not.toBeNull();
    expect(snapshot.status, snapshot.error || `cell size ${cellSize}: diagnostic should complete`).toBe('completed');
    expect(snapshot.completed).toBe(20);
    expect(snapshot.searchCount).toBeGreaterThanOrEqual(20);
    expect(snapshot.failedSearches).toBeLessThanOrEqual(2);

    const result = {
      cellSize,
      elapsedMs: Number(snapshot.elapsedMs.toFixed(1)),
      searchCount: snapshot.searchCount,
      retryCount: snapshot.retryCount,
      routedSearches: snapshot.routedSearches,
      failedSearches: snapshot.failedSearches,
      totalStatesProcessed: snapshot.totalStatesProcessed,
      totalRaySteps: snapshot.totalRaySteps,
      totalObstacleChecks: snapshot.totalObstacleChecks,
      totalSpatialCandidateChecks: snapshot.totalSpatialCandidateChecks,
      totalExhaustiveEquivalentChecks: snapshot.totalExhaustiveEquivalentChecks,
      reductionFactor: Number((snapshot.totalExhaustiveEquivalentChecks / Math.max(1, snapshot.totalSpatialCandidateChecks)).toFixed(2)),
      totalPointQueries: snapshot.totalPointQueries,
      totalSegmentQueries: snapshot.totalSegmentQueries,
      totalSpatialIndexBuildMs: Number(snapshot.totalSpatialIndexBuildMs.toFixed(2)),
      routePaths: snapshot.routePaths
    };
    measurements.push(result);
    console.log('MT-C432-CELL-SWEEP ' + JSON.stringify({ ...result, routePaths: undefined }));
  }

  const reference = JSON.stringify(measurements.find(x => x.cellSize === 128).routePaths);
  for (const result of measurements) {
    expect(JSON.stringify(result.routePaths), `routes must remain identical at cell size ${result.cellSize}`).toBe(reference);
  }
  console.log('MT-C432-CELL-SWEEP-RESULT ' + JSON.stringify(
    measurements.map(({ routePaths, ...item }) => item)
  ));
});
