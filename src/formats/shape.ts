// VGA/*.VGA sprite files (loader: GAME.EXE 0:0060, tree builder 0:023f).
//
// Header (little-endian words): version, header size, data size, set count,
// then per set: id, depth, and a tree where every inner node is a count followed
// by its children and every leaf is a frame offset into the data block.
// Frame: x, y, width, height (bytes), then width*height 8-bit pixels; 0 is transparent.

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export type ShapeNode = Frame | ShapeNode[];

export interface ShapeSet {
  id: number;
  root: ShapeNode[];
}

export function parseShapeFile(bytes: Uint8Array): ShapeSet[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (at: number) => view.getUint16(at, true);
  const headerSize = word(2);
  const data = bytes.subarray(headerSize, headerSize + word(4));
  let at = 8;

  const frame = (offset: number): Frame => {
    const width = data[offset + 2];
    const height = data[offset + 3];
    return {
      x: data[offset],
      y: data[offset + 1],
      width,
      height,
      pixels: data.subarray(offset + 4, offset + 4 + width * height),
    };
  };

  const node = (depth: number): ShapeNode[] => {
    const count = word(at);
    at += 2;
    const children: ShapeNode[] = [];
    for (let i = 0; i < count; i++) {
      if (depth === 1) {
        children.push(frame(word(at)));
        at += 2;
      } else {
        children.push(node(depth - 1));
      }
    }
    return children;
  };

  const sets: ShapeSet[] = [];
  for (let i = word(6); i > 0; i--) {
    const id = word(at);
    const depth = word(at + 2);
    at += 4;
    sets.push({ id, root: node(depth) });
  }
  return sets;
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
