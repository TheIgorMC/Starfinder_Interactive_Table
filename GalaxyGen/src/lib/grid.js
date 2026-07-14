// Density field grids: a GRID_SIZE x GRID_SIZE array of 0..1 floats mapped
// over the galaxy bounds (Docs/10-galaxy-mapgen.md §2.2). Plain Array (not
// Float32Array) so it round-trips through JSON.stringify for save/export.
export const GRID_SIZE = 128;

export function createGrid(size = GRID_SIZE) {
  return new Array(size * size).fill(0);
}

export function getCell(grid, size, gx, gy) {
  gx = Math.max(0, Math.min(size - 1, gx));
  gy = Math.max(0, Math.min(size - 1, gy));
  return grid[gy * size + gx];
}

export function worldToGrid(x, y, bounds, size = GRID_SIZE) {
  return [(x / bounds.width) * size, (y / bounds.height) * size];
}

export function gridToWorld(gx, gy, bounds, size = GRID_SIZE) {
  return [(gx / size) * bounds.width, (gy / size) * bounds.height];
}

// Smoothstep falloff brush: blends every cell within `radiusWorld` of
// (worldX, worldY) toward 1 (or 0 if `erase`), weighted by distance.
// `containsPoint(worldX, worldY) -> bool` optionally restricts painting to
// a sector polygon (Docs/10-galaxy-mapgen.md §5, "constrain to sector").
export function paintGrid(grid, size, bounds, worldX, worldY, radiusWorld, strength, erase, containsPoint) {
  const cellW = bounds.width / size;
  const cellH = bounds.height / size;
  const [gx, gy] = worldToGrid(worldX, worldY, bounds, size);
  const gRadiusX = Math.max(radiusWorld / cellW, 0.5);
  const gRadiusY = Math.max(radiusWorld / cellH, 0.5);
  const minX = Math.max(0, Math.floor(gx - gRadiusX));
  const maxX = Math.min(size - 1, Math.ceil(gx + gRadiusX));
  const minY = Math.max(0, Math.floor(gy - gRadiusY));
  const maxY = Math.min(size - 1, Math.ceil(gy + gRadiusY));
  const sign = erase ? -1 : 1;

  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const dx = (cx + 0.5 - gx) / gRadiusX;
      const dy = (cy + 0.5 - gy) / gRadiusY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) continue;
      if (containsPoint) {
        const [wx, wy] = gridToWorld(cx + 0.5, cy + 0.5, bounds, size);
        if (!containsPoint(wx, wy)) continue;
      }
      const falloff = 1 - dist;
      const weight = falloff * falloff * (3 - 2 * falloff); // smoothstep
      const idx = cy * size + cx;
      const step = sign * strength * weight * 0.12;
      grid[idx] = Math.max(0, Math.min(1, grid[idx] + step));
    }
  }
}
