import { defineConfig } from 'astro/config';

// On GitHub Actions, GITHUB_REPOSITORY looks like "owner/repo".
// A project site lives at https://owner.github.io/repo/, so we need base="/repo".
const repoFull = process.env.GITHUB_REPOSITORY || '';
const [owner, repo] = repoFull.split('/');
const isUserSite = repo && repo.toLowerCase() === `${owner}.github.io`.toLowerCase();

export default defineConfig({
  site: owner ? `https://${owner}.github.io` : undefined,
  base: repo && !isUserSite ? `/${repo}` : '/',
});
