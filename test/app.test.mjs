/**
 * Drives the production build in jsdom, serving the real published API off disk.
 * This is the closest thing to opening the deployed site that runs offline.
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const BASE = "/Commodity-Tracker/";

const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const errors = [];
let pass = 0, fail = 0;

const T = (label, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  → ${extra}` : ""}`);
};

/** Serve dist/ and public/api from the filesystem. */
const serve = (url) => {
  const rel = url.replace(/^https?:\/\/[^/]+/, "").replace(BASE, "");
  for (const dir of [DIST, path.join(ROOT, "public")]) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p, "utf8");
  }
  return null;
};

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: `https://sachingreen.github.io${BASE}`,
  resources: undefined,
  beforeParse(win) {
    win.fetch = async (u) => {
      const body = serve(String(u));
      if (body == null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    };
    win.alert = () => {};
    win.URL.createObjectURL = () => "blob:stub";
    win.URL.revokeObjectURL = () => {};
    win.addEventListener("error", (e) => errors.push(String(e.message)));
  },
});

const { window } = dom;
const d = window.document;
const $ = (s) => d.querySelector(s);
const $$ = (s) => [...d.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// execute the bundle by hand: jsdom won't resolve the module src itself
const bundle = fs.readdirSync(path.join(DIST, "assets")).find((f) => f.endsWith(".js"));
const code = fs.readFileSync(path.join(DIST, "assets", bundle), "utf8");

const run = async () => {
  window.eval(code);
  await tick(400);

  // ---- board
  const rows = $$("tr[data-sym]");
  T("board renders every instrument", rows.length === 26, `${rows.length} rows`);
  T("group headers present", $$("tr.grouphead").length === 7, `${$$("tr.grouphead").length} groups`);
  T("live prices reach the DOM", /78\.4/.test(d.body.textContent), "Brent 78.40 found");
  T("sample-data banner shown while seeded", /Sample data/.test(d.body.textContent));
  T("rows with no archive say so", /no archive/.test(d.body.textContent));

  const cells = $$("tr[data-sym]")[0].querySelectorAll("td");
  T("no NaN anywhere on the board",
    !/NaN|Infinity|undefined/.test($("table.board").textContent),
    [...cells].slice(1, 5).map((c) => c.textContent.trim()).join(" | "));

  // ---- detail chart
  T("projection cone drawn", $$("svg.chart path").length >= 4,
    `${$$("svg.chart path").length} paths`);
  T("cone paths are numeric",
    !$$("svg.chart path").some((p) => /NaN|Infinity/.test(p.getAttribute("d") || "")));
  T("stats populated", $$(".stat dd").length === 4,
    $$(".stat dd").map((x) => x.textContent).join(" | "));

  // ---- watchlist
  const star = $$(".star-btn")[0];
  click(star);
  await tick();
  T("starring writes to storage",
    JSON.parse(window.localStorage.getItem("assay:watchlist") || "[]").length === 1,
    window.localStorage.getItem("assay:watchlist"));

  const watchChip = $$(".chip-btn").find((b) => b.textContent.startsWith("Watchlist"));
  click(watchChip);
  await tick();
  T("watchlist filter narrows the board", $$("tr[data-sym]").length === 1,
    `${$$("tr[data-sym]").length} row`);
  click($$(".chip-btn").find((b) => b.textContent === "All"));
  await tick();

  // ---- highlights
  const nav = (label) => click($$("nav button").find((b) => b.textContent.startsWith(label)));
  nav("Highlights");
  await tick();
  T("automatic highlights appear without any rules", $$(".hl-item").length > 0,
    `${$$(".hl-item").length} items`);
  T("stale prices are flagged", /older than three days|no price archive/.test(d.body.textContent));

  // add a threshold rule that must fire
  const setVal = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(v));
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  setVal($("#rv"), 1);                       // any price is above 1
  await tick();
  click([...$$(".controls button")].find((b) => b.textContent === "Add rule"));
  await tick();
  T("adding a rule produces a highlight",
    $$(".hl-item .tag").some((t) => t.textContent === "your rule"),
    $(".hl-item h4")?.textContent);
  T("rule count shows on the nav badge", $(".badge")?.textContent === "1", $(".badge")?.textContent);
  T("rule persisted", JSON.parse(window.localStorage.getItem("assay:rules") || "[]").length === 1);

  click($$(".rule-row button").at(-1));
  await tick();
  T("removing a rule clears the highlight",
    !$$(".hl-item .tag").some((t) => t.textContent === "your rule"));

  // ---- compare
  nav("Compare");
  await tick();
  const overlayPaths = $$("svg.chart path");
  T("overlay draws a line per instrument", overlayPaths.length >= 3,
    `${overlayPaths.length} lines`);
  T("overlay rebased to 100", /rebased to 100/.test(d.body.textContent));
  T("overlay paths numeric",
    !overlayPaths.some((p) => /NaN/.test(p.getAttribute("d") || "")));

  // ---- correlation
  nav("Correlation");
  await tick(120);
  const corrCells = $$("table.corr td");
  T("correlation matrix rendered", corrCells.length > 100, `${corrCells.length} cells`);
  const diag = $$("table.corr tbody tr").map((tr, i) => tr.querySelectorAll("td")[i]?.textContent);
  T("diagonal is 1.00", diag.every((v) => v === "1.00"), `first: ${diag[0]}`);
  T("no NaN in the matrix", !/NaN/.test($("table.corr").textContent));
  const inRange = corrCells.filter((c) => c.textContent !== "·")
    .every((c) => Math.abs(parseFloat(c.textContent)) <= 1.0000001);
  T("every correlation within [-1, 1]", inRange);

  // ---- basket
  nav("Basket");
  await tick();
  T("basket index renders", /Index level/.test(d.body.textContent),
    $(".card .v")?.textContent);
  T("basket sessions matched shown", $$(".card").length >= 2);
  const legCount = $$(".leg-row").length;
  click($$(".controls button").find((b) => b.textContent === "Add leg"));
  await tick();
  T("adding a leg works", $$(".leg-row").length === legCount + 1,
    `${legCount} → ${$$(".leg-row").length}`);
  T("basket persisted", JSON.parse(window.localStorage.getItem("assay:basket") || "{}").legs?.length === legCount + 1);

  // ---- ledger
  nav("Ledger");
  await tick();
  T("ledger stack renders", $$("#root .stack .seg").length >= 6,
    `${$$(".stack .seg").length} segments incl. ghost`);
  T("ledger totals have no NaN", !/NaN/.test($(".stackwrap").textContent),
    $(".stacklabel em")?.textContent);
  const widths = $$(".stack").at(0).querySelectorAll(".seg");
  T("segment widths are valid percentages",
    [...widths].every((w) => {
      const v = parseFloat(w.style.width);
      return Number.isFinite(v) && v >= 0 && v <= 100;
    }));
  T("leak line written", /costs \$|No 12-month history/.test($(".leak").textContent),
    $(".leak h3")?.textContent);

  // switch to a cargo with no archive
  const cargoSel = $("#cargo");
  setVal(cargoSel, "AGM-CHILLI");
  await tick();
  T("no-archive cargo refuses a fake year-on-year comparison",
    /No 12-month history/.test($(".leak").textContent), $(".leak h3")?.textContent);
  T("ghost bar hidden when there is nothing to compare",
    $$(".stack.ghost").length === 0);

  setVal(cargoSel, "HG=F");
  await tick();
  T("comparison returns for a cargo with history",
    $$(".stack.ghost").length === 1 && /costs \$/.test($(".leak").textContent),
    $(".leak h3")?.textContent);

  // exporter view restricts to crops
  click($$(".toggle button").at(1));
  await tick();
  const opts = [...$("#cargo").options].map((o) => o.textContent);
  T("exporter view offers crops only",
    !opts.some((o) => /Crude|Copper|Nickel|Zinc|Steel|Alumin/.test(o)),
    `${opts.length} options`);

  // ---- routing
  T("hash routing follows the tab", window.location.hash === "#ledger", window.location.hash);

  console.log(errors.length ? `\nRUNTIME ERRORS:\n${errors.join("\n")}` : "\nNo runtime errors.");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error("harness crashed:", e); process.exit(1); });
