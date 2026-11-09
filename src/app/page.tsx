import Link from "next/link";

// Placeholder home page; the market becomes the landing page in the next step.
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Trade NBA players like stocks.</h1>
      <p className="mt-4 text-white/60">Start with $10,000. Prices move every night on real box scores.</p>
      <Link href="/login" className="mt-8 inline-block rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-black">
        Get started
      </Link>
    </main>
  );
}
