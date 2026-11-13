// Adds one employer to data/watchlist.json. Used by the "Add employer" GitHub workflow.
//
// Give it a careers link. If the link is a Greenhouse or Lever job board and the board
// really answers, the employer is added with an automatic feed. Otherwise it is added as a
// link-only employer (shown in the employer list with the star and check buttons).
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const UA = { 'User-Agent': 'coop-finder (personal student project)' };
const FILE = new URL('../data/watchlist.json', import.meta.url);

// ---- work out which job board a link points at ----
export function detectBoard(link) {
  let u;
  try { u = new URL(link); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  if (host.endsWith('greenhouse.io') && !host.includes('.eu.')) {
    let board = u.searchParams.get('for') || '';
    if (!board) board = parts[0] === 'v1' ? parts[2] : parts[0] === 'embed' ? '' : parts[0];
    if (/^[A-Za-z0-9_-]+$/.test(board || '')) return { type: 'greenhouse', board, system: 'Greenhouse' };
  }
  if (host === 'jobs.lever.co' || host === 'api.lever.co') {
    const board = host === 'api.lever.co' ? parts[2] : parts[0];
    if (/^[A-Za-z0-9_-]+$/.test(board || '')) return { type: 'lever', board, system: 'Lever' };
  }
  return null;
}

// Name the careers system for link-only employers.
export function guessSystem(link) {
  let host = '';
  try { host = new URL(link).hostname.toLowerCase(); } catch { /* ignore */ }
  const known = [
    ['myworkdayjobs.com', 'Workday'], ['ashbyhq.com', 'Ashby'], ['bamboohr.com', 'BambooHR'],
    ['workable.com', 'Workable'], ['icims.com', 'iCIMS'], ['teamtailor.com', 'Teamtailor'],
    ['smartrecruiters.com', 'SmartRecruiters'], ['rippling.com', 'Rippling'], ['paycor.com', 'Paycor'],
    ['greenhouse.io', 'Greenhouse'], ['lever.co', 'Lever'], ['taleo.net', 'Taleo'], ['jobvite.com', 'Jobvite'],
  ];
  for (const [h, name] of known) if (host.endsWith(h)) return name;
  return 'Own site';
}

// ---- check that the board really answers (same endpoints the fetch script uses) ----
export async function verifyBoard(b, fetchFn = fetch) {
  const url = b.type === 'greenhouse'
    ? `https://boards-api.greenhouse.io/v1/boards/${b.board}/jobs`
    : `https://api.lever.co/v0/postings/${b.board}?mode=json`;
  try {
    const res = await fetchFn(url, { headers: UA });
    if (!res.ok) return { ok: false, why: `the job board answered HTTP ${res.status}` };
    const data = await res.json();
    const count = b.type === 'greenhouse' ? (data.jobs || []).length : (Array.isArray(data) ? data.length : -1);
    if (count < 0) return { ok: false, why: 'the job board gave an unexpected answer' };
    return { ok: true, count };
  } catch (e) {
    return { ok: false, why: `could not reach the job board (${e.message})` };
  }
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const q = (s) => JSON.stringify(s);

export function formatEntry(e) {
  const lines = [
    `  { "name": ${q(e.name)}, "region": ${q(e.region)}, "type": ${q(e.type)}, "system": ${q(e.system)}, "mode": ${q(e.mode)},`,
    `    "url": ${q(e.url)},`,
  ];
  if (e.feed) lines.push(`    "feed": { "type": ${q(e.feed.type)}, "board": ${q(e.feed.board)} },`);
  lines.push(`    "note": ${q(e.note)} }`);
  return lines.join('\n');
}

// Insert a new entry at the end of the array without reformatting anything else in the file.
export function insertEntry(text, entry) {
  const end = text.lastIndexOf(']');
  if (end < 0) throw new Error('watchlist.json does not look like a list');
  const before = text.slice(0, end).replace(/\s+$/, '');
  const next = `${before},\n${formatEntry(entry)}\n]\n`;
  JSON.parse(next); // refuse to write anything that is not valid JSON
  return next;
}

export async function addEmployer({ name, url, region, type, note }, text, fetchFn = fetch) {
  name = clean(name); url = clean(url); note = clean(note);
  if (!name) throw new Error('Please give the employer a name.');
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('The link must start with http:// or https://');
  const list = JSON.parse(text);
  if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" is already in the watchlist.`);

  const entry = { name, region: region === 'BC' ? 'BC' : 'Elsewhere', type: clean(type) || 'Company', system: guessSystem(url), mode: 'link', url, note };
  let result = 'link-only';
  let why = '';

  const board = detectBoard(url);
  if (board) {
    const check = await verifyBoard(board, fetchFn);
    if (check.ok) {
      entry.system = board.system; entry.mode = 'auto'; entry.feed = { type: board.type, board: board.board };
      if (!entry.note) entry.note = 'Feed is pulled automatically.';
      result = 'automatic feed';
      why = `${board.system} board "${board.board}" answered with ${check.count} posting${check.count === 1 ? '' : 's'} in total (only intern and co-op roles are kept).`;
    } else {
      why = `Looked like a ${board.system} board, but ${check.why}, so it was added as link-only.`;
    }
  } else {
    why = 'Not a Greenhouse or Lever link, so it was added as link-only.';
  }
  return { text: insertEntry(text, entry), entry, result, why };
}

// ---- command line (used by the workflow) ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env;
  const summary = env.GITHUB_STEP_SUMMARY;
  try {
    const text = await readFile(FILE, 'utf8');
    const out = await addEmployer({ name: env.EMP_NAME, url: env.EMP_URL, region: env.EMP_REGION, type: env.EMP_TYPE, note: env.EMP_NOTE }, text);
    await writeFile(FILE, out.text);
    const msg = `Added ${out.entry.name} (${out.result}). ${out.why}`;
    console.log(msg);
    if (summary) await appendFile(summary, `### ${msg}\n`);
  } catch (e) {
    console.error(`Could not add the employer: ${e.message}`);
    if (summary) await appendFile(summary, `### Could not add the employer\n${e.message}\n`);
    process.exit(1);
  }
}
