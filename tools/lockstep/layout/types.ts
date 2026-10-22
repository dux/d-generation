// AGA layout metadata belongs to the truth comparator, never native game state.
export interface FieldLayout {
  readonly name: string;
  readonly offset: number;
  readonly width: 1 | 2 | 4;
  readonly signed?: boolean;
  readonly kind?: "scalar" | "actor-slot" | "profile-index" | "boolean" | "scene-number";
}

export interface ClassLayout {
  readonly id: number;
  readonly fields: readonly FieldLayout[];
}
