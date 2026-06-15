export type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RelativeBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function resolveRelativeBox(parent: Frame, box: RelativeBox): Frame {
  return {
    x: parent.x + parent.width * box.left,
    y: parent.y + parent.height * box.top,
    width: parent.width * box.width,
    height: parent.height * box.height
  };
}

export function layoutMagazineSpread(canvas: Frame) {
  return {
    hero: resolveRelativeBox(canvas, { left: 0.06, top: 0.08, width: 0.56, height: 0.76 }),
    sidebar: resolveRelativeBox(canvas, { left: 0.68, top: 0.12, width: 0.24, height: 0.62 }),
    caption: resolveRelativeBox(canvas, { left: 0.68, top: 0.78, width: 0.24, height: 0.08 })
  };
}
