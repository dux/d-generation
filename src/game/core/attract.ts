export interface AttractDemo { scene: number; sequence: number; x: number; y: number; direction: number }

// g:586 points to g:57b then g:576; the third pointer is the end sentinel g:580 (h0:2e1c..2ea0).
export const ATTRACT_DEMOS: readonly AttractDemo[] = [
  { scene: 76, sequence: 50, x: 57, y: 128, direction: 2 },
  { scene: 65, sequence: 52, x: 57, y: 135, direction: 2 },
];
