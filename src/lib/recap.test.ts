import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerText, shouldShowBanner, type Recap } from "./recap";

const recap: Recap = {
  night: 3, date: "2026-11-10",
  rooms: [
    { room_id: "pub", room_name: "Public", is_public: true, net_worth: 10500, change_pct: 0.012, rank: 14, prev_rank: 20, size: 40 },
    { room_id: "fnh", room_name: "Friday Night Hoops", is_public: false, net_worth: 5210, change_pct: 0.042, rank: 2, prev_rank: 3, size: 6 },
  ],
  best: { ticker: "SGA", name: "Shai Gilgeous-Alexander", total: 0.091, status: "played", line: null },
  worst: { ticker: "LUKA", name: "Luka Dončić", total: -0.08, status: "injured", line: null },
};

test("shouldShowBanner: not without a recap, not once that night is dismissed", () => {
  assert.equal(shouldShowBanner(null, null), false);
  assert.equal(shouldShowBanner(recap, 3), false);
  assert.equal(shouldShowBanner(recap, 2), true);
  assert.equal(shouldShowBanner(recap, null), true);
});

test("bannerText uses your current room", () => {
  assert.equal(bannerText(recap, "fnh"), "Last night: +4.2% · #2 in Friday Night Hoops (▲1) · Best: SGA +9.1%");
  assert.equal(bannerText(recap, "pub"), "Last night: +1.2% · #14 in Public (▲6) · Best: SGA +9.1%");
});

test("bannerText without a previous night or a best player", () => {
  const first = { ...recap, best: null, rooms: [{ ...recap.rooms[1], prev_rank: null }] };
  assert.equal(bannerText(first, "fnh"), "Last night: +4.2% · #2 in Friday Night Hoops");
});
