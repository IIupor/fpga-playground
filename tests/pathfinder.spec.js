const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BENCHMARK = 'c17';

async function loadC17(page) {
  await page.route(
    `https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/${BENCHMARK}.v`,
    async route => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'benchmarks', 'iscas85', `${BENCHMARK}.v`),
        'utf8'
      );
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: source
      });
    }
  );
  await page.goto('/');
  await page.locator('#benchmarkSelect').selectOption(BENCHMARK);
  await page.locator('#loadBenchmark').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
  await expect.poll(() => page.locator('#editorStage path.editor-wire').count(), { timeout: 30000 })
    .toBeGreaterThan(0);
}

async function diagnostics(page) {
  return page.locator('#editorStage').evaluate(svg => {
    const trajectory = JSON.parse(svg.dataset.routingConflictTrajectory || '[]');
    const wires = [...svg.querySelectorAll('path.editor-wire')].map(path => {
      const points = [...(path.getAttribute('d') || '').matchAll(/[ML]\s*([-\d.]+)[, ]+([-\d.]+)/g)]
        .map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
      return {
        id: path.dataset.wire,
        from: path.dataset.from,
        to: path.dataset.to,
        points,
        d: path.getAttribute('d') || ''
      };
    });
    return {
      validated: svg.dataset.routingValidated,
      finalConflicts: Number(svg.dataset.routingConflicts),
      passes: Number(svg.dataset.routingPasses),
      trajectory,
      wires,
      modelWireCount: Array.isArray(window.fpgaWires) ? window.fpgaWires.length : null
    };
  });
}

test.describe('Pathfinder routing diagnostics (c17)', () => {
  test('01: publishes final routing diagnostics', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    expect(['true', 'false']).toContain(d.validated);
    expect(Number.isInteger(d.finalConflicts)).toBeTruthy();
    expect(Number.isInteger(d.passes)).toBeTruthy();
    expect(d.trajectory.length).toBeGreaterThan(0);
  });

  test('02: pass numbers are consecutive and start at one', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    expect(d.trajectory.map(p => p.pass)).toEqual(d.trajectory.map((_, i) => i + 1));
  });

  test('03: negotiated routing respects the configured pass limit', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    expect(d.passes).toBeLessThanOrEqual(12);
    expect(d.passes).toBe(d.trajectory.length);
  });

  test('04: initial pass accounts for every routed net', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    expect(d.trajectory[0].rerouted).toBe(d.modelWireCount);
  });

  test('05: reroute count never exceeds the number of nets', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    for (const pass of d.trajectory) {
      expect(pass.rerouted, `pass ${pass.pass}`).toBeGreaterThanOrEqual(0);
      expect(pass.rerouted, `pass ${pass.pass}`).toBeLessThanOrEqual(d.modelWireCount);
    }
  });

  test('06: every pass reports finite, non-negative conflict and missing-route counts', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    for (const pass of d.trajectory) {
      expect(Number.isInteger(pass.conflicts)).toBeTruthy();
      expect(pass.conflicts).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(pass.missingRoutes)).toBeTruthy();
      expect(pass.missingRoutes).toBeGreaterThanOrEqual(0);
    }
  });

  test('07: final solution is no worse than the best recorded pass with the same missing-route count', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    const finalMissing = d.trajectory.at(-1).missingRoutes;
    const comparable = d.trajectory
      .filter(pass => pass.missingRoutes === finalMissing)
      .map(pass => pass.conflicts);
    expect(comparable.length).toBeGreaterThan(0);
    expect(d.finalConflicts).toBeLessThanOrEqual(Math.min(...comparable));
  });

  test('08: every model net has a rendered wire path', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    expect(d.wires).toHaveLength(d.modelWireCount);
    expect(new Set(d.wires.map(w => w.id)).size).toBe(d.modelWireCount);
  });

  test('09: every rendered route has valid orthogonal geometry', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    for (const wire of d.wires) {
      expect(wire.id, 'wire identity').toBeTruthy();
      expect(wire.from, 'source node').not.toBeNull();
      expect(wire.to, 'target node').not.toBeNull();
      expect(wire.points.length, `wire ${wire.id} needs at least two points`).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < wire.points.length; i++) {
        const a = wire.points[i - 1], b = wire.points[i];
        expect(a.x === b.x || a.y === b.y, `wire ${wire.id} segment ${i} is diagonal`).toBeTruthy();
      }
    }
  });

  test('10: final conflict diagnostic agrees with independently measured route geometry', async ({ page }) => {
    await loadC17(page);
    const d = await diagnostics(page);
    const measured = await page.locator('#editorStage').evaluate(svg => {
      const segments = [];
      for (const path of svg.querySelectorAll('path.editor-wire')) {
        const points = [...(path.getAttribute('d') || '').matchAll(/[ML]\s*([-\d.]+)[, ]+([-\d.]+)/g)]
          .map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
        for (let i = 1; i < points.length; i++) {
          segments.push({ wire: path.dataset.wire, a: points[i - 1], b: points[i] });
        }
      }
      let conflicts = 0;
      for (let i = 0; i < segments.length; i++) {
        const a = segments[i];
        for (let j = i + 1; j < segments.length; j++) {
          const b = segments[j];
          if (a.wire === b.wire) continue;
          const ah = a.a.y === a.b.y, bh = b.a.y === b.b.y;
          if (ah !== bh) {
            const h = ah ? a : b, v = ah ? b : a;
            const x = v.a.x, y = h.a.y;
            if (x > Math.min(h.a.x, h.b.x) && x < Math.max(h.a.x, h.b.x) &&
                y > Math.min(v.a.y, v.b.y) && y < Math.max(v.a.y, v.b.y)) conflicts++;
          } else if (ah && a.a.y === b.a.y) {
            if (Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x)) <
                Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x))) conflicts++;
          } else if (!ah && a.a.x === b.a.x) {
            if (Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)) <
                Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y))) conflicts++;
          }
        }
      }
      return conflicts;
    });
    expect(d.finalConflicts).toBe(measured);
  });
});
