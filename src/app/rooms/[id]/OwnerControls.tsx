"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/forms";
import { removeMember, resetInvite } from "../actions";

export function InviteLink({ roomId, url }: { roomId: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs text-white/80" />
        <button type="button"
          onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400">
          {copied ? "Copied" : "Copy invite link"}
        </button>
      </div>
      <button type="button" disabled={pending}
        onClick={() => {
          if (!confirm("Create a new invite link? The current link will stop working.")) return;
          startTransition(async () => setState(await resetInvite(roomId)));
        }}
        className="text-xs text-white/50 underline hover:text-white disabled:opacity-50">
        Reset invite link
      </button>
      {state.message && <p role="status" className={`text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}>{state.message}</p>}
    </div>
  );
}

export function RemoveMemberButton({ roomId, userId, username }: { roomId: string; userId: string; username: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex items-center gap-2">
      {state.message && !state.ok && <span className="text-xs text-red-300">{state.message}</span>}
      <button type="button" disabled={pending}
        onClick={() => {
          if (!confirm(`Remove ${username}? Their holdings and trades in this room are deleted.`)) return;
          startTransition(async () => setState(await removeMember(roomId, userId)));
        }}
        className="text-xs text-red-300/80 hover:text-red-300 disabled:opacity-50">
        Remove
      </button>
    </span>
  );
}
