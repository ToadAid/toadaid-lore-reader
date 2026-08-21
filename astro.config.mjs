import { defineConfig } from 'astro/config';
import { normalizePublicBase } from './src/lib/public-site.ts';

const base = normalizePublicBase(process.env.PUBLIC_BASE);
const site = process.env.PUBLIC_SITE;

export default defineConfig({
  base,
  ...(site ? { site } : {}),
});
