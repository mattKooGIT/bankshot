import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient, postLoginPath } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 mb-8 text-sm text-white/60">New here? Signing in creates your account with $10,000 to trade.</p>
      <Suspense>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const sp = await searchParams;
  const next = postLoginPath(typeof sp.next === "string" ? sp.next : undefined);
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect(next); // already signed in

  return <LoginForm next={next} error={error} />;
}
