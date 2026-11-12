"use client";

import { useFormStatus } from "react-dom";
import { startDemo } from "@/app/demo/actions";

function Submit({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={`${className} disabled:opacity-60`}>
      {pending ? "Setting up your demo…" : "Try the demo — no sign-up"}
    </button>
  );
}

/** One click: a guest account with a ready-made league. */
export function DemoButton({ className }: { className: string }) {
  return (
    <form action={startDemo}>
      <Submit className={className} />
    </form>
  );
}
