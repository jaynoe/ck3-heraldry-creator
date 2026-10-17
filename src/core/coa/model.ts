// Coat-of-arms data model, mirroring the structure of CK3 `coat_of_arms` script definitions.

export type ColorValue =
  | { kind: 'named'; name: string }
  | { kind: 'rgb'; value: [number, number, number] } // 0-255
  | { kind: 'hsv'; value: [number, number, number] } // 0-1
  | { kind: 'hsv360'; value: [number, number, number] } // h 0-360, s/v 0-100
  /** Reference to one of the enclosing CoA's colours, e.g. `color1 = color2`. */
  | { kind: 'ref'; slot: number };

export interface EmblemInstance {
  /** Centre of the emblem in [0,1] CoA space, y pointing down. Default 0.5 0.5. */
  position?: [number, number];
  /** Size relative to the CoA. A negative component mirrors the emblem. Default 1 1. */
  scale?: [number, number];
  /** Degrees, clockwise. Default 0. */
  rotation?: number;
  /** Draw order between emblems; higher values are drawn later. */
  depth?: number;
}

export interface ColoredEmblem {
  texture: string;
  /** Up to three colours; missing entries are not set in the script. */
  colors: (ColorValue | undefined)[];
  instances: EmblemInstance[];
  /** Pattern channels (1-3) the emblem is clipped to. */
  mask?: number[];
}

export interface TexturedEmblem {
  texture: string;
  instances: EmblemInstance[];
  mask?: number[];
}

export interface SubInstance {
  offset?: [number, number];
  scale?: [number, number];
}

export interface SubCoa {
  /** Either a reference to another CoA definition … */
  parent?: string;
  /** … or an inline CoA. */
  coa?: CoatOfArms;
  instances: SubInstance[];
}

export interface CoatOfArms {
  /** Inherits all fields from another CoA definition. */
  parent?: string;
  pattern?: string;
  /** colors[0] is color1 … colors[4] is color5. */
  colors: (ColorValue | undefined)[];
  coloredEmblems: ColoredEmblem[];
  texturedEmblems: TexturedEmblem[];
  subs: SubCoa[];
}

export function emptyCoa(): CoatOfArms {
  return { colors: [], coloredEmblems: [], texturedEmblems: [], subs: [] };
}

export const DEFAULT_POSITION: [number, number] = [0.5, 0.5];
export const DEFAULT_SCALE: [number, number] = [1, 1];
