"use client";

import { useEffect, useRef, useState } from "react";
import { EmojiPicker, type EmojiPickerListCategoryHeaderProps, type EmojiPickerListEmojiProps, type EmojiPickerListRowProps } from "frimousse";
import { POPULAR } from "@/lib/feed";

// Stable list parts (defined once, so the virtualized list never remounts them).
function CategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return <div {...props} className="bg-[#15181d] px-1 pb-1 pt-2 text-xs text-white/50">{category.label}</div>;
}
function Row({ children, ...props }: EmojiPickerListRowProps) {
  return <div {...props} className="scroll-my-1 px-0.5">{children}</div>;
}
function Emoji({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button {...props} className={`flex size-8 items-center justify-center rounded-md text-lg ${emoji.isActive ? "bg-white/10" : ""}`}>
      {emoji.emoji}
    </button>
  );
}

/** ☺+ button: a "Popular" row above a searchable picker. Stays open so you can pick several. */
export function EmojiMenu({ mine, onPick }: { mine: string[]; onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button ref={button} type="button" aria-label="Add reaction" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/60 hover:border-white/30 hover:text-white">
        ☺+
      </button>
      {open && (
        <div role="dialog" aria-label="Pick reactions"
          className="absolute left-0 z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-white/15 bg-[#15181d] p-2 shadow-xl shadow-black/50">
          <div className="mb-2 flex items-center gap-1">
            <span className="mr-1 text-xs text-white/50">Popular</span>
            {POPULAR.map((e) => (
              <button key={e} type="button" aria-pressed={mine.includes(e)} onClick={() => onPick(e)}
                className={`flex size-8 items-center justify-center rounded-md text-lg hover:bg-white/10 ${mine.includes(e) ? "bg-emerald-500/20 ring-1 ring-emerald-400/60" : ""}`}>
                {e}
              </button>
            ))}
          </div>
          <EmojiPicker.Root onEmojiSelect={({ emoji }) => onPick(emoji)} columns={8} className="flex h-72 flex-col">
            <EmojiPicker.Search autoFocus placeholder="Search emoji" aria-label="Search emoji"
              className="mb-2 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm outline-none focus:border-white/40" />
            <EmojiPicker.Viewport className="relative flex-1 outline-none">
              <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-xs text-white/50">Loading…</EmojiPicker.Loading>
              <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-xs text-white/50">No emoji found.</EmojiPicker.Empty>
              <EmojiPicker.List className="select-none pb-1" components={{ CategoryHeader, Row, Emoji }} />
            </EmojiPicker.Viewport>
          </EmojiPicker.Root>
        </div>
      )}
    </div>
  );
}
