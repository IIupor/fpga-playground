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
  const same = (a, b) => a.x === b.x && a.y === b.y;
  if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(start.y) ||
      !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
    throw new TypeError('start and end must have finite x/y coordinates');
  }
  if (same(start, end)) return [{ x: start.x, y: start.y }];

  const rects = obstacles.map((r) => ({
    left: r.left - clearance,
    right: r.right + clearance,
    top: r.top - clearance,
    bottom: r.bottom + clearance
  }));
  const inside = (p, r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
  if (rects.some((r) => inside(start, r) || inside(end, r))) return null;

  const xs = new Set([start.x, end.x]);
  const ys = new Set([start.y, end.y]);
  for (const r of rects) {
    xs.add(r.left); xs.add(r.right);
    ys.add(r.top); ys.add(r.bottom);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const key = (i, j) => i + ',' + j;
  const point = (i, j) => ({ x: X[i], y: Y[j] });
  const blockedPoint = (p) => rects.some((r) => inside(p, r));
  const clear = (a, b) => {
    if (a.x !== b.x && a.y !== b.y) return false;
    for (const r of rects) {
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
    if (key(i, j) === targetKey) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let ni = i + di, nj = j + dj;
      while (ni >= 0 && ni < X.length && nj >= 0 && nj < Y.length) {
        const next = point(ni, nj);
        if (blockedPoint(next) || !clear(here, next)) break;
        const nk = key(ni, nj);
        if (!parent.has(nk)) {
          parent.set(nk, key(i, j));
          queue.push([ni, nj]);
        }
        ni += di; nj += dj;
      }
    }
  }
  if (!parent.has(targetKey)) return null;
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
  return simplified;
}

window.routeMikamiTabuchi = routeMikamiTabuchi;