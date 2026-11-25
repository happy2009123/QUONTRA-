import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface CommandPaletteContextValue {
  paletteOpen: boolean;
  helpOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const toggleHelp = useCallback(() => setHelpOpen((v) => !v), []);

  const value = useMemo(
    () => ({
      paletteOpen,
      helpOpen,
      openPalette,
      closePalette,
      togglePalette,
      openHelp,
      closeHelp,
      toggleHelp,
    }),
    [paletteOpen, helpOpen, openPalette, closePalette, togglePalette, openHelp, closeHelp, toggleHelp],
  );

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider');
  return ctx;
}
