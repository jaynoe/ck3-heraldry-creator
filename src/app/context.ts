import { createContext, useContext } from 'react';
import type { Playset } from '../core/mods/playsets.ts';
import type { RenderContext } from '../core/render/render.ts';
import type { HeraldrySession } from '../core/session.ts';
import type { Platform } from './platform/types.ts';

export interface AppState {
  platform: Platform;
  playset: Playset;
  session: HeraldrySession;
  ctx: RenderContext;
}

export const AppContext = createContext<AppState | undefined>(undefined);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('useApp outside of a loaded playset');
  return state;
}
