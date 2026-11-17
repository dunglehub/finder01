// Pulls jobs from public job-board APIs (Greenhouse, Lever, Workable, Workday, SmartRecruiters) and writes data/jobs.json.
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

  // Workable's public widget feed (apply.workable.com/<account>)
  async workable(account) {
    const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${account}?details=true`);
    return (data.jobs || []).map((j) => ({
      id: `wk-${account}-${j.shortcode}`,
      title: j.title,
      location: [j.city, j.state, j.country].filter(Boolean).join(', '),
      url: j.url || j.shortlink,
      posted: j.published_on || (j.created_at ? String(j.created_at).slice(0, 10) : null),
      description: stripHtml(j.description || ''),
    }));
  },
  // SmartRecruiters public postings API. board = company identifier (jobs.smartrecruiters.com/<id>)
  async smartrecruiters(id) {
    const seen = new Map();
    for (const q of ['co-op', 'coop', 'intern', 'student']) {
      const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${id}/postings?limit=100&q=${encodeURIComponent(q)}`);
      for (const j of data.content || []) {
        if (seen.has(j.id)) continue;
        seen.set(j.id, {
          id: `sr-${id}-${j.id}`,
          title: j.name,
          location: [j.location?.city, j.location?.region, j.location?.country?.toUpperCase()].filter(Boolean).join(', '),
          url: `https://jobs.smartrecruiters.com/${id}/${j.id}`,
          posted: j.releasedDate ? String(j.releasedDate).slice(0, 10) : null,
          description: '',
        });
      }
    }
    return [...seen.values()];
  },

  // Workday career sites. board = "<tenant>.<wdN>/<site>", e.g. "qualcomm.wd12/External"
  async workday(board) {
    const [host, site] = board.split('/');
    const tenant = host.split('.')[0];
    const base = `https://${host}.myworkdayjobs.com`;
    const seen = new Map();
    for (const q of ['co-op', 'coop', 'intern', 'student']) {
      const res = await fetch(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: q }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const j of data.jobPostings || []) {
        if (!j.externalPath || seen.has(j.externalPath)) continue;
        const m = /Posted (Today|Yesterday|(\d+) Days? Ago)/i.exec(j.postedOn || '');
        let posted = null;
        if (m) {
          const back = /today/i.test(m[1]) ? 0 : /yesterday/i.test(m[1]) ? 1 : Number(m[2]);
          posted = new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
        }
        seen.set(j.externalPath, {
          id: `wd-${tenant}-${j.externalPath.split('_').pop()}`,
          title: j.title,
          location: j.locationsText || '',
          url: `${base}/en-US/${site}${j.externalPath}`,
          posted,
          description: '',
        });
      }
    }
    return [...seen.values()];
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

// ---- JSearch (Google for Jobs: Indeed, LinkedIn, Glassdoor ...) ----
// Needs the JSEARCH_API_KEY secret. Settings live in data/jsearch.json. To save the small free quota it only
// refreshes every "everyDays" days (or when the workflow is started by hand); other runs keep the earlier results.
async function jsearchRun(cfg, key) {
  const hosts = [
    { url: 'https://api.openwebninja.com/jsearch/search', headers: { 'x-api-key': key } },
    { url: 'https://jsearch.p.rapidapi.com/search', headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' } },
  ];
  let host = 0;
  const seen = new Map();
  for (const country of cfg.countries) {
    for (const query of cfg.queries) {
      const qs = new URLSearchParams({ query, country, employment_types: 'INTERN', date_posted: cfg.datePosted || 'month', num_pages: String(cfg.pages || 1) });
      let res = await fetch(`${hosts[host].url}?${qs}`, { headers: { ...UA, ...hosts[host].headers } });
      if ((res.status === 401 || res.status === 403) && host === 0) {
        host = 1;
        res = await fetch(`${hosts[host].url}?${qs}`, { headers: { ...UA, ...hosts[host].headers } });
      }
      if (!res.ok) throw new Error(`JSearch HTTP ${res.status}`);
      const data = await res.json();
      for (const j of data.data || []) {
        if (seen.has(j.job_id)) continue;
        const types = (j.job_employment_types || [j.job_employment_type]).join(' ');
        if (!isEarlyCareer(j.job_title) && !/INTERN/i.test(types)) continue;
        seen.set(j.job_id, enrich({
          id: `js-${j.job_id}`.slice(0, 120),
          title: String(j.job_title || '').trim(),
          location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') + (j.job_is_remote ? ' (remote)' : ''),
          url: j.job_apply_link || j.job_google_link,
          posted: j.job_posted_at_datetime_utc ? String(j.job_posted_at_datetime_utc).slice(0, 10) : null,
          company: j.employer_name || 'Unknown',
          source: 'auto',
          via: j.job_publisher || 'JSearch',
          description: String(j.job_description || '').replace(/\s+/g, ' ').slice(0, 4000),
        }));
      }
    }
  }
  return [...seen.values()];
}

{
  let previous = [];
  try { previous = JSON.parse(await readFile(new URL('../data/jobs.json', import.meta.url), 'utf8')); } catch {}
  const old = previous.filter((j) => String(j.id).startsWith('js-'));
  let cfg = null;
  try { cfg = JSON.parse(await readFile(new URL('../data/jsearch.json', import.meta.url), 'utf8')); } catch {}
  const key = process.env.JSEARCH_API_KEY;
  if (cfg && key) {
    const now = new Date();
    const day = Math.floor(now.getTime() / 864e5);
    const due = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || old.length === 0 ||
      (now.getUTCHours() === 17 && day % (cfg.everyDays || 3) === 0);
    if (due) {
      try {
        const found = await jsearchRun(cfg, key);
        out.push(...found);
        console.log(`JSearch: ${found.length} early-career jobs`);
      } catch (err) {
        console.warn(`! JSearch failed (${err.message})`);
        out.push(...old);
      }
    } else {
      out.push(...old);
      console.log(`JSearch: not due, kept ${old.length} earlier jobs`);
    }
  } else {
    out.push(...old);
    if (cfg) console.log('JSearch: no JSEARCH_API_KEY secret, skipped');
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
