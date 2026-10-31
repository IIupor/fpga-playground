const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const circuits = ['c17', 'c432', 'c499', 'c880', 'c1355', 'c1908', 'c2670', 'c3540', 'c5315', 'c6288', 'c7552'];

for (const name of circuits) {
  test(name + ': complete orthogonal geometry audit', async ({ page }) => {
    test.setTimeout(180000);
    const fixture = path.join(__dirname, '..', 'benchmarks', 'iscas85', name + '.v');
    await page.route('https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/' + name + '.v',
      route => route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: fs.readFileSync(fixture, 'utf8')
      }));

    await page.goto('/');
    const startedAt = await page.evaluate(() => performance.now());
    await page.locator('#benchmarkSelect').selectOption(name);
    await page.locator('#loadBenchmark').click();
    await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 90000 });
    await expect.poll(() => page.locator('#editorStage path.editor-wire').count(), { timeout: 90000 })
      .toBeGreaterThan(0);

    const report = await page.locator('#editorStage').evaluate((svg, startedAt) => {
      const nodes = [...window.fpgaNodes];
      const wires = [...window.fpgaWires];
      const paths = [...svg.querySelectorAll('path.editor-wire')];
      const nodeGroups = [...svg.querySelectorAll('g[data-node]')];
      const junctions = [...svg.querySelectorAll('circle.wire-junction')];
      const circles = junctions.map(c => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) }));
      const wireById = new Map(wires.map(w => [String(w.id), w]));
      const routes = paths.map(path => {
        const points = [...(path.getAttribute('d') || '').matchAll(/[ML]\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)/g)]
          .map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
        const wire = wireById.get(path.dataset.wire);
        return {
          id: path.dataset.wire,
          from: Number(path.dataset.from),
          to: Number(path.dataset.to),
          net: wire ? String(wire.from) + ':' + String(wire.fromPin || 0) : 'missing:' + path.dataset.wire,
          points
        };
      });
      const boxes = nodeGroups.map(g => {
        const b = g.querySelector('rect.nodebox').getBBox();
        const m = /translate\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)/.exec(g.getAttribute('transform') || '');
        const x = b.x + (m ? Number(m[1]) : 0);
        const y = b.y + (m ? Number(m[2]) : 0);
        return { id: Number(g.dataset.node), l: x, t: y, r: x + b.width, b: y + b.height };
      });

      const segments = [];
      let emptyRoutes = 0, diagonalSegments = 0, blockPenetrations = 0;
      let totalRouteLength = 0;
      for (const route of routes) {
        if (route.points.length < 2) { emptyRoutes++; continue; }
        for (let i = 1; i < route.points.length; i++) {
          const a = route.points[i - 1], b = route.points[i];
          if (a.x === b.x && a.y === b.y) continue;
          if (a.x !== b.x && a.y !== b.y) { diagonalSegments++; continue; }
          totalRouteLength += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
          const horizontal = a.y === b.y;
          const segment = {
            wire: route.id, net: route.net, from: route.from, to: route.to,
            a, b, horizontal,
            lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
            hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
            fixed: horizontal ? a.y : a.x
          };
          segments.push(segment);
          for (const box of boxes) {
            if (box.id === route.from || box.id === route.to) continue;
            const hit = horizontal
              ? a.y > box.t && a.y < box.b && Math.max(segment.lo, box.l) < Math.min(segment.hi, box.r)
              : a.x > box.l && a.x < box.r && Math.max(segment.lo, box.t) < Math.min(segment.hi, box.b);
            if (hit) blockPenetrations++;
          }
        }
      }

      // Sweep every horizontal/vertical segment pair, including endpoint and T contacts.
      const horizontals = segments.filter(s => s.horizontal);
      const verticals = segments.filter(s => !s.horizontal);
      const yCoordinates = [...new Set(horizontals.map(s => s.fixed))].sort((a, b) => a - b);
      const lowerBound = (arr, value) => {
        let lo = 0, hi = arr.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < value) lo = mid + 1; else hi = mid; }
        return lo;
      };
      const events = [];
      for (const h of horizontals) {
        events.push({ x: h.lo, kind: 0, segment: h });
        events.push({ x: h.hi, kind: 2, segment: h });
      }
      for (const v of verticals) events.push({ x: v.fixed, kind: 1, segment: v });
      events.sort((a, b) => a.x - b.x || a.kind - b.kind);

      const activeByY = new Map();
      let properCrossings = 0, endpointContacts = 0, crossingsWithJunctionMarkers = 0;
      const crossingExamples = [], contactExamples = [];
      for (const event of events) {
        const s = event.segment;
        if (event.kind === 0) {
          if (!activeByY.has(s.fixed)) activeByY.set(s.fixed, []);
          activeByY.get(s.fixed).push(s);
        } else if (event.kind === 2) {
          const list = activeByY.get(s.fixed) || [];
          const index = list.indexOf(s);
          if (index >= 0) list.splice(index, 1);
          if (!list.length) activeByY.delete(s.fixed);
        } else {
          const first = lowerBound(yCoordinates, s.lo);
          for (let yi = first; yi < yCoordinates.length && yCoordinates[yi] <= s.hi; yi++) {
            const y = yCoordinates[yi];
            for (const h of activeByY.get(y) || []) {
              if (h.net === s.net) continue;
              const proper = h.lo < s.fixed && s.fixed < h.hi && s.lo < y && y < s.hi;
              if (proper) {
                properCrossings++;
                if (circles.some(circle => circle.x === s.fixed && circle.y === y)) crossingsWithJunctionMarkers++;
                if (crossingExamples.length < 12) crossingExamples.push({
                  wires: [h.wire, s.wire], nets: [h.net, s.net], at: { x: s.fixed, y }
                });
              } else {
                endpointContacts++;
                if (contactExamples.length < 12) contactExamples.push({
                  wires: [h.wire, s.wire], nets: [h.net, s.net], at: { x: s.fixed, y }
                });
              }
            }
          }
        }
      }

      // Audit collinear overlap on every horizontal and vertical coordinate.
      let collinearOverlaps = 0, collinearEndpointContacts = 0;
      const overlapExamples = [];
      for (const horizontal of [true, false]) {
        const byCoordinate = new Map();
        for (const s of segments) {
          if (s.horizontal !== horizontal) continue;
          if (!byCoordinate.has(s.fixed)) byCoordinate.set(s.fixed, []);
          byCoordinate.get(s.fixed).push(s);
        }
        for (const [coordinate, list] of byCoordinate) {
          list.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
          const active = [];
          for (const current of list) {
            for (let i = active.length - 1; i >= 0; i--) {
              if (active[i].hi < current.lo) active.splice(i, 1);
            }
            for (const previous of active) {
              if (previous.net === current.net) continue;
              const overlap = Math.min(previous.hi, current.hi) - Math.max(previous.lo, current.lo);
              if (overlap > 0) {
                collinearOverlaps++;
                if (overlapExamples.length < 12) overlapExamples.push({
                  orientation: horizontal ? 'H' : 'V', coordinate,
                  wires: [previous.wire, current.wire],
                  range: [Math.max(previous.lo, current.lo), Math.min(previous.hi, current.hi)]
                });
              } else if (overlap === 0) {
                collinearEndpointContacts++;
              }
            }
            active.push(current);
          }
        }
      }

      // A fanout must have a shared non-zero trunk between every pair of sinks,
      // and every fanout route must contain a rendered junction marker.
      const fanout = new Map();
      for (const w of wires) {
        const key = String(w.from) + ':' + String(w.fromPin || 0);
        if (!fanout.has(key)) fanout.set(key, []);
        fanout.get(key).push(String(w.id));
      }
      const onRoute = (point, route) => route.points.some((a, i) => {
        if (i === route.points.length - 1) return false;
        const b = route.points[i + 1];
        return a.x === b.x
          ? point.x === a.x && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
          : a.y === b.y && point.y === a.y && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x);
      });
      let expectedJunctions = 0, missingSharedTrunks = 0, missingJunctionMarkers = 0;
      for (const ids of fanout.values()) {
        if (ids.length < 2) continue;
        expectedJunctions += ids.length;
        const netRoutes = ids.map(id => routes.find(r => r.id === id)).filter(Boolean);
        for (let i = 0; i < netRoutes.length; i++) {
          for (let j = i + 1; j < netRoutes.length; j++) {
            const a = netRoutes[i], b = netRoutes[j];
            let sharedSegment = false;
            for (let ai = 1; ai < a.points.length && !sharedSegment; ai++) {
              const a1 = a.points[ai - 1], a2 = a.points[ai];
              for (let bi = 1; bi < b.points.length; bi++) {
                const b1 = b.points[bi - 1], b2 = b.points[bi];
                const sameHorizontal = a1.y === a2.y && b1.y === b2.y && a1.y === b1.y &&
                  Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x)) < Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x));
                const sameVertical = a1.x === a2.x && b1.x === b2.x && a1.x === b1.x &&
                  Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y)) < Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y));
                if (sameHorizontal || sameVertical) { sharedSegment = true; break; }
              }
            }
            if (!sharedSegment) missingSharedTrunks++;
          }
        }
        for (const route of netRoutes) {
          const targetBends = [];
          for (let i = 1; i < route.points.length - 1; i++) {
            const previous = route.points[i - 1], point = route.points[i], next = route.points[i + 1];
            if (previous.y === point.y && next.x === point.x &&
                previous.x !== point.x && next.y !== point.y) targetBends.push(point);
          }
          const markedBends = targetBends.filter(point =>
            circles.some(circle => circle.x === point.x && circle.y === point.y));
          if (markedBends.length !== 1) missingJunctionMarkers++;
        }
      }

      const missingRoutes = routes.filter(r => r.points.length < 2 || !wireById.has(r.id)).length +
        wires.filter(w => !routes.some(r => r.id === String(w.id))).length;
      return {
        nodes: nodes.length, renderedNodes: nodeGroups.length,
        wires: wires.length, renderedWires: routes.length,
        segments: segments.length, missingRoutes, diagonalSegments, blockPenetrations,
        properCrossings, crossingsWithJunctionMarkers, endpointContacts, collinearOverlaps, collinearEndpointContacts,
        expectedJunctions, renderedJunctions: circles.length,
        missingSharedTrunks, missingJunctionMarkers,
        totalRouteLength, routingTracks: window.fpgaRoutingTrackCount,
        elapsedMs: performance.now() - startedAt,
        examples: { crossings: crossingExamples, contacts: contactExamples, overlaps: overlapExamples }
      };
    }, startedAt);

    console.log('GEOMETRY_AUDIT ' + name + ': ' + JSON.stringify(report));
    expect(report.renderedNodes, name + ': all nodes must render').toBe(report.nodes);
    expect(report.renderedWires, name + ': all logical wires must render').toBe(report.wires);
    expect(report.missingRoutes, name + ': no missing or empty routes').toBe(0);
    expect(report.diagonalSegments, name + ': all route segments must be orthogonal').toBe(0);
    expect(report.blockPenetrations, name + ': routes must avoid unrelated blocks').toBe(0);
    // Orthogonal crossings between distinct logical nets are legal. They are
    // reported as a readability metric, but must never carry a junction dot.
    expect(report.crossingsWithJunctionMarkers, name + ': independent crossings must not be marked as electrical junctions').toBe(0);
    expect(report.endpointContacts, name + ': independent wires must not form unintended T/corner contacts').toBe(0);
    expect(report.collinearOverlaps, name + ': independent wires must not overlap').toBe(0);
    expect(report.collinearEndpointContacts, name + ': independent wires must not touch collinearly').toBe(0);
    expect(report.renderedJunctions, name + ': fanout marker count must match').toBe(report.expectedJunctions);
    expect(report.missingSharedTrunks, name + ': every fanout pair must share a routed trunk').toBe(0);
    expect(report.missingJunctionMarkers, name + ': every fanout route must contain a visible marker').toBe(0);
    expect(report.routingTracks, name + ': routing track count must be available').toBeGreaterThan(0);
    expect(report.totalRouteLength, name + ': total Manhattan route length must be positive').toBeGreaterThan(0);
  }, 180000);
}
