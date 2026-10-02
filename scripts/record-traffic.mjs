#!/usr/bin/env node
/**
 * Append GitHub traffic + star count to a local data directory so the history
 * outlives GitHub's 14-day traffic window.
 *
 * Output (inside <dir>):
 *   views.csv, clones.csv   date,count,uniques — one row per day; a re-fetched
 *                           day is overwritten, since the newest fetch is the
 *                           most complete (today's row is always partial).
 *   stars.csv               date,stars — one snapshot per run date.
 *   referrers/<date>.json   rolling 14-day aggregates as GitHub returns them;
 *   paths/<date>.json       snapshots overlap, so do not sum across files.
 *
 * Usage:
 *   GH_TOKEN=... node scripts/record-traffic.mjs <dir> [owner/repo]
 *
 * The token needs repository "Administration: read" (fine-grained) or `repo`
 * scope (classic) — the default GITHUB_TOKEN cannot read traffic.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [dir, repo = process.env.GITHUB_REPOSITORY] = process.argv.slice(2);
const token = process.env.GH_TOKEN;
if (!dir || !repo || !token) {
  console.error("usage: GH_TOKEN=... node scripts/record-traffic.mjs <dir> [owner/repo]");
  process.exit(2);
}

async function gh(endpoint) {
  const res = await fetch(`https://api.github.com/repos/${repo}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GET ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function readCsv(file) {
  try {
    const lines = (await readFile(file, "utf8")).trim().split("\n").slice(1);
    return new Map(lines.filter(Boolean).map((l) => [l.slice(0, 10), l]));
  } catch (err) {
    if (err.code === "ENOENT") return new Map();
    throw err;
  }
}

async function upsertCsv(name, header, rows) {
  const file = path.join(dir, name);
  const byDate = await readCsv(file);
  for (const row of rows) byDate.set(row.slice(0, 10), row);
  const sorted = [...byDate.keys()].sort().map((d) => byDate.get(d));
  await writeFile(file, [header, ...sorted].join("\n") + "\n");
}

async function writeJson(sub, date, data) {
  await mkdir(path.join(dir, sub), { recursive: true });
  await writeFile(path.join(dir, sub, `${date}.json`), JSON.stringify(data, null, 2) + "\n");
}

const today = new Date().toISOString().slice(0, 10);
const [views, clones, referrers, paths, meta] = await Promise.all([
  gh("/traffic/views"),
  gh("/traffic/clones"),
  gh("/traffic/popular/referrers"),
  gh("/traffic/popular/paths"),
  gh(""),
]);

await mkdir(dir, { recursive: true });
const daily = (items) => items.map((v) => `${v.timestamp.slice(0, 10)},${v.count},${v.uniques}`);
await upsertCsv("views.csv", "date,count,uniques", daily(views.views));
await upsertCsv("clones.csv", "date,count,uniques", daily(clones.clones));
await upsertCsv("stars.csv", "date,stars", [`${today},${meta.stargazers_count}`]);
await writeJson("referrers", today, referrers);
await writeJson("paths", today, paths);

console.log(
  `${today}: ${views.views.length} view days, ${clones.clones.length} clone days, ` +
    `${meta.stargazers_count} stars, ${referrers.length} referrers`,
);
