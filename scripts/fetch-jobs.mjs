// Pulls jobs from public job-board APIs (Greenhouse, Lever) and writes data/jobs.json.
// Only official public job-board endpoints are used (no scraping).
import { readFile, writeFile } from 'node:fs/promises';
import { isEarlyCareer, stripHtml, enrich } from './lib/classify.mjs';

const UA = { 'User-Agent': 'coop-finder (personal student project)' };

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Each fetcher returns plain objects: { id, title, location, url, posted, description }
const fetchers = {
  async greenhouse(board) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
    return (data.jobs || []).map((j) => ({
      id: `gh-${board}-${j.id}`,
      title: j.title,
      location: j.location?.name || '',
      url: j.absolute_url,
      posted: j.first_published ? j.first_published.slice(0, 10) : null,
      description: stripHtml(j.content || ''),
    }));
  },

  async lever(board) {
    const data = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j) => {
      const extra = (j.lists || []).map((l) => `${l.text} ${stripHtml(l.content || '')}`).join(' ');
      return {
        id: `lv-${board}-${j.id}`,
        title: j.text,
        location: j.categories?.location || (j.categories?.allLocations || []).join(', '),
        url: j.hostedUrl,
        posted: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : null,
        description: `${j.descriptionPlain || ''} ${extra} ${j.additionalPlain || ''}`.replace(/\s+/g, ' ').trim(),
      };
    });
  },
};

const watchlist = JSON.parse(await readFile(new URL('../data/watchlist.json', import.meta.url), 'utf8'));
const feeds = watchlist.filter((c) => c.feed && fetchers[c.feed.type]);

const out = [];
const problems = [];

for (const company of feeds) {
  try {
    const jobs = await fetchers[company.feed.type](company.feed.board);
    let kept = 0;
    for (const j of jobs) {
      if (!isEarlyCareer(j.title)) continue;
      out.push(
        enrich({
          ...j,
          title: j.title.trim(),
          company: company.name,
          source: 'auto',
          description: j.description.slice(0, 4000),
        }),
      );
      kept++;
    }
    console.log(`${company.name}: ${kept} early-career jobs (of ${jobs.length})`);
  } catch (err) {
    problems.push(`${company.name}: ${err.message}`);
    console.warn(`! ${company.name} failed (${err.message})`);
  }
}

// If every feed failed, keep the previous file instead of wiping the site.
if (feeds.length && problems.length === feeds.length) {
  console.error('All feeds failed; leaving data/jobs.json unchanged.');
  process.exit(0);
}

// A single failing feed should not erase that employer's earlier jobs: carry them over.
if (problems.length) {
  let previous = [];
  try {
    previous = JSON.parse(await readFile(new URL('../data/jobs.json', import.meta.url), 'utf8'));
  } catch {}
  const failed = new Set(
    feeds.filter((c) => problems.some((p) => p.startsWith(c.name + ':'))).map((c) => c.name),
  );
  out.push(...previous.filter((j) => failed.has(j.company)));
}

// Stable order so the file only changes when jobs actually change.
out.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(new URL('../data/jobs.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${out.length} jobs.${problems.length ? ' Problems: ' + problems.join('; ') : ''}`);
