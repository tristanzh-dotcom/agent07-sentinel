import { layoutMagazineSpread } from "./layout.js";

export function exportSvg(width = 1600, height = 900) {
  const layout = layoutMagazineSpread({ x: 0, y: 0, width, height });
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#050505"/>
    <rect x="${layout.hero.x}" y="${layout.hero.y}" width="${layout.hero.width}" height="${layout.hero.height}" fill="#f5f5f0"/>
    <rect x="${layout.sidebar.x}" y="${layout.sidebar.y}" width="${layout.sidebar.width}" height="${layout.sidebar.height}" fill="#1a1a1a"/>
  </svg>`;
}
