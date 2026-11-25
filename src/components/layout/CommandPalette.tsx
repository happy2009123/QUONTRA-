import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Keyboard, Search, Star, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NAV_GROUPS } from './nav';
import { INSTRUMENTS, INSTRUMENT_BY_ID } from '@/data/universe';
import { useCommandPalette } from '@/state/CommandPaletteContext';
import { useWatchlist } from '@/state/WatchlistContext';
import { cn } from '@/lib/cn';

interface PaletteEntry {
  id: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  run: () => void;
}

interface PaletteSection {
  title: string;
  entries: PaletteEntry[];
}

/** `g` + key jump shortcuts (terminal-style navigation). */
const GOTO: Record<string, string> = {
  d: '/',
  s: '/scanner',
  c: '/charts',
  t: '/paper-trading',
  b: '/backtesting',
  r: '/risk',
  n: '/notifications',
  l: '/strategy-lab',
};

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function ShortcutGroup({ title, rows }: { title: string; rows: readonly (readonly [string, string])[] }) {
  return (
    <div>
      <p className="section-title mb-1.5">{title}</p>
      <dl className="space-y-1">
        {rows.map(([keys, description]) => (
          <div key={keys} className="flex items-center justify-between gap-3">
            <dt className="num shrink-0 rounded-[3px] border border-line bg-panel px-1.5 py-0.5 text-[10.5px] text-mut">
              {keys}
            </dt>
            <dd className="truncate text-right text-[12px] text-mut">{description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { paletteOpen, helpOpen, openPalette, closePalette, togglePalette, openHelp, closeHelp, toggleHelp } =
    useCommandPalette();
  const { ids: watchIds } = useWatchlist();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const gStamp = useRef(0);

  // Global shortcuts: ⌘K/Ctrl+K, "/", "?" and `g` + key sequences.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePalette();
        return;
      }
      if (paletteOpen || helpOpen) {
        if (event.key === 'Escape') {
          if (helpOpen) closeHelp();
          else closePalette();
        }
        return;
      }
      if (isEditable(event.target)) return;
      if (event.key === '/') {
        event.preventDefault();
        openPalette();
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        toggleHelp();
        return;
      }
      const now = Date.now();
      if (now - gStamp.current < 1200) {
        const destination = GOTO[event.key.toLowerCase()];
        gStamp.current = 0;
        if (destination) {
          event.preventDefault();
          navigate(destination);
          return;
        }
      }
      gStamp.current = event.key === 'g' ? now : 0;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, helpOpen, togglePalette, closePalette, closeHelp, openPalette, toggleHelp, navigate]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setActive(0);
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (paletteOpen) inputRef.current?.focus();
  }, [paletteOpen]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!paletteOpen) return;
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, paletteOpen]);

  const pageEntries = useMemo<PaletteEntry[]>(
    () =>
      NAV_GROUPS.flatMap((group) =>
        group.items.map((item) => ({
          id: `page:${item.to}`,
          label: item.label,
          hint: group.label,
          icon: item.icon,
          run: () => {
            navigate(item.to);
            closePalette();
          },
        })),
      ),
    [navigate, closePalette],
  );

  const instrumentEntries = useMemo<PaletteEntry[]>(
    () =>
      INSTRUMENTS.map((inst) => ({
        id: `inst:${inst.id}`,
        label: inst.symbol,
        hint: `${inst.name} · ${inst.exchange}`,
        run: () => {
          navigate(`/charts?instrument=${inst.id}`);
          closePalette();
        },
      })),
    [navigate, closePalette],
  );

  const watchEntries = useMemo<PaletteEntry[]>(
    () =>
      watchIds.flatMap((id) => {
        const inst = INSTRUMENT_BY_ID[id];
        if (!inst) return [];
        return [
          {
            id: `watch:${id}`,
            label: inst.symbol,
            hint: inst.name,
            icon: Star,
            run: () => {
              navigate(`/charts?instrument=${id}`);
              closePalette();
            },
          },
        ];
      }),
    [watchIds, navigate, closePalette],
  );

  const trimmed = query.trim().toLowerCase();

  const sections = useMemo<PaletteSection[]>(() => {
    const out: PaletteSection[] = [];
    if (trimmed) {
      const instruments = instrumentEntries
        .filter(
          (entry) =>
            entry.label.toLowerCase().includes(trimmed) ||
            (entry.hint ?? '').toLowerCase().includes(trimmed),
        )
        .slice(0, 8);
      const pages = pageEntries.filter(
        (entry) =>
          entry.label.toLowerCase().includes(trimmed) ||
          (entry.hint ?? '').toLowerCase().includes(trimmed),
      );
      if (instruments.length > 0) out.push({ title: 'Instruments', entries: instruments });
      if (pages.length > 0) out.push({ title: 'Pages', entries: pages });
    } else {
      if (watchEntries.length > 0) out.push({ title: 'Watchlist', entries: watchEntries });
      out.push({ title: 'Pages', entries: pageEntries });
      out.push({
        title: 'Actions',
        entries: [
          {
            id: 'action:shortcuts',
            label: 'Keyboard shortcuts',
            hint: 'Press ?',
            icon: Keyboard,
            run: () => {
              closePalette();
              openHelp();
            },
          },
        ],
      });
    }
    return out;
  }, [trimmed, instrumentEntries, pageEntries, watchEntries, openHelp, closePalette]);

  const flat = useMemo(() => sections.flatMap((section) => section.entries), [sections]);

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (flat.length > 0 ? (i + 1) % flat.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (flat.length > 0 ? (i - 1 + flat.length) % flat.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      flat[active]?.run();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    }
  };

  if (!paletteOpen && !helpOpen) return null;

  return (
    <>
      {paletteOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[12vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <div className="fade-in fixed inset-0 bg-black/60" onClick={closePalette} aria-hidden />
          <div className="pop-in relative w-full max-w-[560px] overflow-hidden rounded-[6px] border border-line bg-card shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search size={14} className="shrink-0 text-mut" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search instruments and pages…"
                aria-label="Search instruments and pages"
                className="h-11 min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-mut-2"
              />
              <kbd className="num shrink-0 rounded-[3px] border border-line px-1.5 py-0.5 text-[9.5px] text-mut-2">
                Esc
              </kbd>
            </div>
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1.5">
              {flat.length === 0 && (
                <p className="px-4 py-6 text-center text-[12.5px] text-mut">
                  No matches for “{query.trim()}”
                </p>
              )}
              {sections.map((section) => (
                <div key={section.title}>
                  <p className="section-title px-3 pb-1 pt-2">{section.title}</p>
                  {section.entries.map((entry) => {
                    const index = flat.indexOf(entry);
                    const Icon = entry.icon;
                    const selected = index === active;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        data-active={selected}
                        onMouseEnter={() => setActive(index)}
                        onClick={entry.run}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3 py-2 text-left',
                          'transition-[background-color,color] duration-150',
                          selected ? 'bg-gold/10 text-fg' : 'text-mut hover:bg-panel hover:text-fg',
                        )}
                      >
                        {Icon ? (
                          <Icon size={14} className="shrink-0" aria-hidden />
                        ) : (
                          <span className="w-3.5 shrink-0" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{entry.label}</span>
                        {entry.hint && (
                          <span className="max-w-[45%] shrink-0 truncate text-[11px] text-mut-2">
                            {entry.hint}
                          </span>
                        )}
                        {selected && <CornerDownLeft size={12} className="shrink-0 text-gold" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[10.5px] text-mut-2">
              <span>↑↓ navigate · ↵ open</span>
              <span>Press ? for shortcuts</span>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[10vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <div className="fade-in fixed inset-0 bg-black/60" onClick={closeHelp} aria-hidden />
          <div className="pop-in relative w-full max-w-[480px] overflow-hidden rounded-[6px] border border-line bg-card shadow-2xl">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-fg">Keyboard shortcuts</h2>
              <button
                type="button"
                onClick={closeHelp}
                aria-label="Close shortcuts"
                className="rounded p-1 text-mut transition-[background-color,color,scale] duration-150 ease-out hover:bg-panel hover:text-fg motion-safe:active:scale-95 focus-visible:outline-2 focus-visible:outline-gold/70"
              >
                <X size={14} aria-hidden />
              </button>
            </header>
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
              <ShortcutGroup
                title="Global"
                rows={[
                  ['⌘K / Ctrl K', 'Open search'],
                  ['/', 'Open search'],
                  ['?', 'This cheat sheet'],
                ]}
              />
              <ShortcutGroup
                title="Go to"
                rows={[
                  ['g d', 'Dashboard'],
                  ['g s', 'Market scanner'],
                  ['g c', 'Charting terminal'],
                  ['g t', 'Paper trading'],
                  ['g b', 'Backtesting'],
                  ['g r', 'Risk center'],
                  ['g n', 'Notifications'],
                  ['g l', 'Strategy lab'],
                ]}
              />
              <ShortcutGroup
                title="In search"
                rows={[
                  ['↑ ↓', 'Move selection'],
                  ['Enter', 'Open selection'],
                  ['Esc', 'Close'],
                ]}
              />
              <ShortcutGroup
                title="Elsewhere"
                rows={[
                  ['Esc', 'Close dialog or menu'],
                  ['Tab', 'Move focus'],
                ]}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
