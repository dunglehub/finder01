# Co-op Finder: Summer 2027

A static job board (Astro + GitHub Pages) for intern and co-op roles in mechanical, battery, EV and clean-energy engineering.

## How it works

- `data/watchlist.json` lists employers. Entries with a `feed` are pulled automatically; the rest are shown as links.
- `scripts/fetch-jobs.mjs` reads public Greenhouse job boards, keeps only intern/co-op/student titles, and writes `data/jobs.json`.
- `data/manual-jobs.json` is for jobs you find by hand. The script never touches it.
- A GitHub Action runs every 6 hours, updates `jobs.json` if anything changed, rebuilds, and deploys.
- Each job gets badges: BC or not, SolidWorks mentioned, and whether its start date fits May 2027.

## Set up on GitHub

1. Create a new repository and push these files to the `main` branch.
2. Repo Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. Actions tab > "Update jobs and deploy" > Run workflow. The site goes live at `https://<username>.github.io/<repo>/`.

## Add a job by hand

Edit `data/manual-jobs.json` on GitHub (pencil icon) and add an entry like the existing one. Optional `"start": "May 2027"` sets the start date.

## Add another Greenhouse employer

Add an entry to `data/watchlist.json` with `"feed": { "type": "greenhouse", "board": "<board name>" }`. The board name is the last part of `job-boards.greenhouse.io/<board>`.

## Run locally

```
npm install
npm run fetch
npm run dev
```
