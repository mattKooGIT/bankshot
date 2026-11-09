// Records the product demo video from the real app.
//
//   1. npm run fake-espn            (fake live games)
//   2. npm run preview:fake-live    (production build on http://localhost:3001)
//   3. npm run record-demo          (writes public/demo.webm and public/demo-poster.png)
//
// Uses a dedicated, leaderboard-hidden account (needs migration 0009).
import { chromium, type Locator, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.DEMO_BASE ?? "http://localhost:3001";
const EMAIL = "demo@courtside.invalid";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ───────── Demo account ─────────

async function demoSession() {
  const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (created.error && !/already/i.test(created.error.message)) throw created.error;

  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  if (error) throw error;
  const userId = link.user.id;
  const upd = await admin.from("profiles").update({ username: "courtside_demo", hidden: true }).eq("id", userId);
  if (upd.error) throw new Error(`${upd.error.message} (did you run migration 0009?)`);

  // Verify the one-time token with the same SSR library the app uses, capturing its cookies.
  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient(URL_, ANON, {
    cookies: { getAll: () => jar, setAll: (cs) => cs.forEach(({ name, value }) => {
      const i = jar.findIndex((c) => c.name === name);
      if (i >= 0) jar.splice(i, 1);
      if (value) jar.push({ name, value });
    }) },
  });
  const v = await ssr.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return { cookies: jar, ssr };
}

// ───────── On-screen cursor and captions (injected into every page) ─────────

const OVERLAY = `
(() => {
  const css = document.createElement("style");
  css.textContent = \`
    #demo-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      background: rgba(255,255,255,.9); box-shadow: 0 0 0 3px rgba(52,211,153,.55), 0 2px 10px rgba(0,0,0,.6);
      z-index: 2147483647; pointer-events: none; transition: transform .12s ease; }
    #demo-cursor.down { transform: scale(.7); box-shadow: 0 0 0 9px rgba(52,211,153,.35); }
    #demo-caption { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483646;
      padding: 12px 22px; border-radius: 10px; background: rgba(11,13,16,.88); border: 1px solid rgba(255,255,255,.15);
      color: #e8eaed; font: 600 22px/1.3 system-ui, sans-serif; pointer-events: none; white-space: nowrap; }
    #demo-end { position: fixed; inset: 0; z-index: 2147483646; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 14px; background: #0b0d10; color: #e8eaed; font: 800 64px/1 system-ui, sans-serif; }
    #demo-end small { font: 500 24px/1.3 system-ui, sans-serif; color: #34d399; }\`;
  const add = () => {
    document.head.appendChild(css);
    const c = document.createElement("div"); c.id = "demo-cursor"; document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => c.classList.add("down"), true);
    addEventListener("mouseup", () => c.classList.remove("down"), true);
  };
  if (document.body) add(); else addEventListener("DOMContentLoaded", add);
  window.__caption = (text) => {
    let el = document.getElementById("demo-caption");
    if (!el) { el = document.createElement("div"); el.id = "demo-caption"; document.body.appendChild(el); }
    el.textContent = text;
  };
  window.__endCard = (title, sub) => {
    const el = document.createElement("div"); el.id = "demo-end";
    el.innerHTML = title + "<small>" + sub + "</small>"; document.body.appendChild(el);
  };
})();
`;

// ───────── Helpers ─────────

const pause = (p: Page, ms: number) => p.waitForTimeout(ms);
let cursor = { x: 640, y: 360 };

async function caption(p: Page, text: string) {
  await p.evaluate((t) => (window as unknown as { __caption: (s: string) => void }).__caption(t), text);
  await p.mouse.move(cursor.x, cursor.y); // re-show the cursor after a navigation
}

async function moveTo(p: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("target not visible");
  cursor = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await p.mouse.move(cursor.x, cursor.y, { steps: 28 });
  await pause(p, 350);
}

async function click(p: Page, target: Locator) {
  await moveTo(p, target);
  await p.mouse.down();
  await pause(p, 120);
  await p.mouse.up();
}

async function go(p: Page, path: string) {
  await p.goto(BASE + path, { waitUntil: "networkidle" });
}

// ───────── Recording ─────────

async function main() {
  const { cookies, ssr } = await demoSession();
  const videoDir = mkdtempSync(join(tmpdir(), "courtside-demo-"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    reducedMotion: "no-preference",
  });
  await ctx.addCookies(cookies.map((c) => ({ ...c, url: BASE })));
  await ctx.addInitScript(OVERLAY);
  const p = await ctx.newPage();
  const started = Date.now();

  // 1. Market
  await go(p, "/market");
  await caption(p, "Every NBA rotation player is a stock.");
  await p.screenshot({ path: "public/demo-poster.png" });
  await moveTo(p, p.getByRole("table"));
  await pause(p, 900);
  await click(p, p.getByRole("button", { name: /Last night/ }));
  await pause(p, 1600);

  // 2. Player page
  await click(p, p.getByRole("link", { name: /Luka/ }).first());
  await p.waitForURL(/\/players\/LUKA/);
  await caption(p, "Prices move on real box scores.");
  await pause(p, 1500);
  await p.mouse.wheel(0, 650);
  await pause(p, 1800);
  await p.mouse.wheel(0, -650);
  await pause(p, 800);

  // 3. Buy
  await caption(p, "Buy with paper money.");
  const shares = p.getByLabel("Shares");
  await click(p, shares);
  await shares.fill("");
  await shares.pressSequentially("5", { delay: 180 });
  await pause(p, 700);
  await click(p, p.getByRole("button", { name: /^Buy 5 LUKA/ }));
  await p.getByRole("status").filter({ hasText: /Bought/ }).waitFor({ timeout: 10_000 });
  await pause(p, 1800);

  // 4. Live scores
  await go(p, "/scores");
  await caption(p, "Watch your players live.");
  await pause(p, 1500);
  await click(p, p.getByRole("button", { name: /Box score/ }).first());
  await pause(p, 1200);
  await p.mouse.wheel(0, 420);
  await pause(p, 2000);

  // 5. Rooms
  await go(p, "/rooms");
  await caption(p, "Start a league with friends.");
  await pause(p, 800);
  const name = p.getByPlaceholder("Friday Night Hoops");
  await click(p, name);
  await name.pressSequentially("Friday Night Hoops", { delay: 70 });
  await pause(p, 600);
  await click(p, p.getByRole("button", { name: "Create room" }));
  await p.waitForURL(/\/rooms\/[0-9a-f-]{36}$/);
  const roomId = p.url().split("/").pop()!;
  await caption(p, "Send the invite link. Everyone gets their own bankroll.");
  await pause(p, 900);
  await moveTo(p, p.getByRole("button", { name: /Copy invite link/ }));
  await pause(p, 2200);

  // 6. End card
  await p.evaluate(() => (window as unknown as { __endCard: (a: string, b: string) => void }).__endCard("Courtside Exchange", "Play free."));
  await p.evaluate(() => document.getElementById("demo-caption")?.remove());
  await pause(p, 2600);

  const seconds = Math.round((Date.now() - started) / 1000);
  const video = p.video()!;
  await ctx.close();
  await browser.close();
  copyFileSync(await video.path(), "public/demo.webm");

  // Clean up the demo room (its trades in Public stay; the account is hidden).
  const del = await ssr.rpc("delete_room", { p_room: roomId });
  if (del.error) console.warn(`Couldn't delete the demo room: ${del.error.message}`);

  console.log(`Recorded ~${seconds}s → public/demo.webm (+ public/demo-poster.png)`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
