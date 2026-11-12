// End-to-end check of "Try the demo" on a running site (default: the 3001 preview).
//
//   npx tsx --env-file=.env.local scripts/try-demo.ts [screenshot-dir]
//
// Clicks the landing page's demo button, checks the Demo League feed, reacts with 🐐 via the
// emoji menu, replies to a comment, checks the portfolio, then deletes the guest it created.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.DEMO_BASE ?? "http://localhost:3001";
const OUT = process.argv[2] ?? "demo-shots";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

function check(ok: boolean, what: string) {
  if (!ok) throw new Error(`Check failed: ${what}`);
  console.log(`✓ ${what}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let room: string | null = null;
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Try the demo — no sign-up" }).first().click();
    await page.waitForURL(/\/rooms\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    room = page.url().split("/").pop()!;
    check(true, `landed in a Demo League (${room})`);

    const feed = page.locator("section", { has: page.getByRole("heading", { name: "Activity" }) });
    await feed.getByText(/^Night \d+/).first().waitFor();
    check(true, "nightly results card is in the feed");
    for (const text of ["welcome to the league 👋", "fade_master you're cooked", "buy low, cry later", "@fade_master check the standings first"]) {
      check(await feed.getByText(text).count() > 0, `feed shows "${text}"`);
    }
    check(await page.getByText("You're in a demo account. It resets in 24 hours.").isVisible(), "guest bar is shown");
    const standings = page.locator("section", { has: page.getByRole("heading", { name: "Standings" }) });
    for (const bot of ["bucket_getter", "fade_master", "sixth_man"]) {
      check(await standings.getByText(bot).count() > 0, `standings include ${bot}`);
    }
    await page.screenshot({ path: join(OUT, "1-demo-league.png"), fullPage: true });

    // React with 🐐 via the ☺+ menu's search.
    const row = feed.locator("li", { hasText: "buy low, cry later" });
    await row.getByRole("button", { name: "Add reaction" }).first().click();
    const menu = page.getByRole("dialog", { name: "Pick reactions" });
    await menu.getByLabel("Search emoji").fill("goat");
    await menu.getByRole("gridcell", { name: /goat/i }).first().click({ timeout: 15_000 });
    check(await menu.isVisible(), "menu stays open after picking");
    await page.screenshot({ path: join(OUT, "2-emoji-menu.png") });
    await page.keyboard.press("Escape");
    await row.getByRole("button", { name: "🐐 1" }).waitFor({ timeout: 10_000 });
    check(true, "🐐 reaction added");

    // Reply to the comment.
    await row.getByRole("button", { name: "Reply" }).first().click();
    await row.getByLabel("Reply").fill("bots talking trash already?");
    await row.getByRole("button", { name: "Reply", exact: true }).last().click();
    await row.getByText("bots talking trash already?").waitFor({ timeout: 10_000 });
    check(true, "reply posted under the comment");
    await row.screenshot({ path: join(OUT, "3-reply.png") });

    await page.goto(BASE + "/portfolio", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0, null, { timeout: 15_000 });
    const rows = await page.locator("a[href^='/players/']").count();
    check(rows >= 4, `portfolio lists the guest's holdings (${rows} player links)`);
    await page.screenshot({ path: join(OUT, "4-portfolio.png"), fullPage: true });
  } finally {
    await browser.close();
    if (room) {
      const { data } = await admin.from("rooms").select("owner_id").eq("id", room).single();
      await admin.from("rooms").delete().eq("id", room);
      if (data?.owner_id) await admin.auth.admin.deleteUser(data.owner_id);
      console.log("Cleaned up the test guest and room.");
    }
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
