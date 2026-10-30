'use strict';

/**
 * Orthogonal line-expansion router (Mikami–Tabuchi-style prototype).
 *
 * Coordinates are compressed to source/target coordinates and obstacle
 * clearance tracks. From each reached intersection, horizontal and vertical
 * search lines expand until an obstacle blocks them. The first reached target
 * gives a rectilinear path. This module is isolated from the production editor
 * so it can be validated before integration.
 */
function routeMikamiTabuchi(start, end, obstacles = [], options = {}) {
  const clearance = Number.isFinite(options.clearance) ? options.clearance : 8;
  const maxStates = Number.isFinite(options.maxStates) ? options.maxStates : 100000;
  const useSpatialIndex = options.useSpatialIndex !== false;
  const cellSize = Number.isFinite(options.spatialCellSize) && options.spatialCellSize > 0 ? options.spatialCellSize : 128;
  const clock = () => (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
  const startedAt = clock();
  const metrics = options.metrics && typeof options.metrics === 'object' ? options.metrics : null;
  if (metrics) Object.assign(metrics, {
    status: 'running', elapsedMs: 0, searchTimeMs: 0, coordinateBuildMs: 0,
    xLines: 0, yLines: 0, coordinateLines: 0, gridPointCount: 0,
    obstacleCount: obstacles.length, statesProcessed: 0, raySteps: 0,
    obstaclePointChecks: 0, obstacleSegmentChecks: 0, pointQueries: 0, segmentQueries: 0,
    spatialIndexBuildMs: 0, spatialCandidateChecks: 0, maxQueueLength: 1
  });
  const finish = (result, status) => {
    if (metrics) {
      metrics.status = status;
      metrics.elapsedMs = clock() - startedAt;
      metrics.searchTimeMs = metrics.elapsedMs;
      metrics.obstacleChecks = metrics.obstaclePointChecks + metrics.obstacleSegmentChecks;
      metrics.exhaustiveEquivalentChecks = (metrics.pointQueries + metrics.segmentQueries) * rects.length;
    }
    return result;
  };
  const same = (a, b) => a.x === b.x && a.y === b.y;
  if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(start.y) ||
      !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
    throw new TypeError('start and end must have finite x/y coordinates');
  }
  if (same(start, end)) return finish([{ x: start.x, y: start.y }], 'same-point');

  const rects = obstacles.map((r) => ({
    left: r.left - clearance,
    right: r.right + clearance,
    top: r.top - clearance,
    bottom: r.bottom + clearance
  }));
  const inside = (p, r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;

  // Uniform spatial hash: each rectangle is stored in every cell touched by
  // its inclusive AABB. Queries may return extra candidates at cell boundaries,
  // but exact predicates below remain authoritative (no false negatives).
  const indexStartedAt = clock();
  const obstacleIndex = new Map();
  const oversized = [];
  const cell = value => Math.floor(value / cellSize);
  const cellKey = (x, y) => x + ',' + y;
  if (useSpatialIndex) {
    for (const r of rects) {
      const minX = cell(r.left), maxX = cell(r.right);
      const minY = cell(r.top), maxY = cell(r.bottom);
      const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
      if (cellCount > 1024) { oversized.push(r); continue; }
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const k = cellKey(x, y);
          let bucket = obstacleIndex.get(k);
          if (!bucket) obstacleIndex.set(k, bucket = []);
          bucket.push(r);
        }
      }
    }
  }
  if (metrics) metrics.spatialIndexBuildMs = clock() - indexStartedAt;
  const pointCandidates = p => {
    if (!useSpatialIndex) return rects;
    return [...new Set([...(obstacleIndex.get(cellKey(cell(p.x), cell(p.y))) || []), ...oversized])];
  };
  const segmentCandidates = (a, b) => {
    if (!useSpatialIndex) return rects;
    const found = new Set(oversized);
    if (a.y === b.y) {
      const y = cell(a.y);
      for (let x = cell(Math.min(a.x, b.x)); x <= cell(Math.max(a.x, b.x)); x++) {
        const bucket = obstacleIndex.get(cellKey(x, y));
        if (bucket) for (const r of bucket) found.add(r);
      }
    } else {
      const x = cell(a.x);
      for (let y = cell(Math.min(a.y, b.y)); y <= cell(Math.max(a.y, b.y)); y++) {
        const bucket = obstacleIndex.get(cellKey(x, y));
        if (bucket) for (const r of bucket) found.add(r);
      }
    }
    return found;
  };
  let endpointBlocked = false;
  for (const r of rects) {
    if (metrics) metrics.obstaclePointChecks++;
    if (inside(start, r) || inside(end, r)) { endpointBlocked = true; break; }
  }
  if (endpointBlocked) return finish(null, 'blocked-endpoint');

  const coordinateBuildStartedAt = clock();

  const xs = new Set([start.x, end.x]);
  const ys = new Set([start.y, end.y]);
  for (const r of rects) {
    xs.add(r.left); xs.add(r.right);
    ys.add(r.top); ys.add(r.bottom);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  if (metrics) {
    metrics.coordinateBuildMs = clock() - coordinateBuildStartedAt;
    metrics.xLines = X.length;
    metrics.yLines = Y.length;
    metrics.coordinateLines = X.length + Y.length;
    metrics.gridPointCount = X.length * Y.length;
  }
  const key = (i, j) => i + ',' + j;
  const point = (i, j) => ({ x: X[i], y: Y[j] });
  const blockedPoint = (p) => {
    if (metrics) metrics.pointQueries++;
    for (const r of pointCandidates(p)) {
      if (metrics) { metrics.obstaclePointChecks++; metrics.spatialCandidateChecks++; }
      if (inside(p, r)) return true;
    }
    return false;
  };
  const clear = (a, b) => {
    if (a.x !== b.x && a.y !== b.y) return false;
    if (metrics) metrics.segmentQueries++;
    for (const r of segmentCandidates(a, b)) {
      if (metrics) { metrics.obstacleSegmentChecks++; metrics.spatialCandidateChecks++; }
      if (a.y === b.y) {
        if (a.y > r.top && a.y < r.bottom &&
            Math.max(Math.min(a.x, b.x), r.left) < Math.min(Math.max(a.x, b.x), r.right)) return false;
      } else if (a.x > r.left && a.x < r.right &&
                 Math.max(Math.min(a.y, b.y), r.top) < Math.min(Math.max(a.y, b.y), r.bottom)) return false;
    }
    return true;
  };
  const locate = (values, v) => values.findIndex((x) => x === v);
  const source = [locate(X, start.x), locate(Y, start.y)];
  const target = [locate(X, end.x), locate(Y, end.y)];
  const sourceKey = key(...source), targetKey = key(...target);
  const queue = [source];
  const parent = new Map([[sourceKey, null]]);
  let head = 0, expansions = 0;

  // Each expansion probes the four orthogonal rays, discovering every clear
  // track intersection before the first blocking obstacle.
  while (head < queue.length && expansions < maxStates) {
    const [i, j] = queue[head++];
    const here = point(i, j);
    expansions++;
    if (metrics) metrics.statesProcessed = expansions;
    if (key(i, j) === targetKey) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let ni = i + di, nj = j + dj;
      while (ni >= 0 && ni < X.length && nj >= 0 && nj < Y.length) {
        const next = point(ni, nj);
        if (metrics) metrics.raySteps++;
        if (blockedPoint(next) || !clear(here, next)) break;
        const nk = key(ni, nj);
        if (!parent.has(nk)) {
          parent.set(nk, key(i, j));
          queue.push([ni, nj]);
          if (metrics && queue.length > metrics.maxQueueLength) metrics.maxQueueLength = queue.length;
        }
        ni += di; nj += dj;
      }
    }
  }
  if (!parent.has(targetKey)) return finish(null, expansions >= maxStates && head < queue.length ? 'state-limit' : 'unroutable');
  const path = [];
  for (let k = targetKey; k !== null; k = parent.get(k)) {
    const [i, j] = k.split(',').map(Number);
    path.push(point(i, j));
  }
  path.reverse();
  const simplified = [];
  for (const p of path) {
    while (simplified.length >= 2) {
      const a = simplified[simplified.length - 2], b = simplified[simplified.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) simplified.pop();
      else break;
    }
    if (!simplified.length || !same(simplified[simplified.length - 1], p)) simplified.push(p);
  }
  return finish(simplified, 'routed');
}

module.exports = { routeMikamiTabuchi };