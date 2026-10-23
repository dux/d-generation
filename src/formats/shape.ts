// Sprite frames and the shape-set tree of the sprite banks (assets/sprites, read by ./src/formats/pack.ts):
// every inner node is a list of children, every leaf a frame.

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8Array;
  // 1 = opaque. Without a mask, color 0 is transparent.
  mask?: Uint8Array;
}

export type ShapeNode = Frame | ShapeNode[];

export interface ShapeSet {
  id: number;
  root: ShapeNode[];
}

export function isFrame(node: ShapeNode): node is Frame {
  return !Array.isArray(node);
}

export function frameAt(root: ShapeNode[], ...path: number[]): Frame {
  let node: ShapeNode = root;
  for (const i of path) node = (node as ShapeNode[])[i];
  if (!isFrame(node)) throw new Error(`shape path ${path.join("/")} is not a frame`);
  return node;
}

export function allFrames(root: ShapeNode[]): { path: number[]; frame: Frame }[] {
  const out: { path: number[]; frame: Frame }[] = [];
  const walk = (nodes: ShapeNode[], path: number[]) =>
    nodes.forEach((n, i) => (isFrame(n) ? out.push({ path: [...path, i], frame: n }) : walk(n, [...path, i])));
  walk(root, []);
  return out;
}
