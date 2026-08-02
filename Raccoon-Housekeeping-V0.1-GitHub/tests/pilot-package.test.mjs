import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the installable app has the Raccoon identity and required icons", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "Raccoon Housekeeping");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});

test("the offline worker caches the operational shell", async () => {
  const worker = await read("public/sw.js");
  assert.match(worker, /raccoon-housekeeping-v0\.1\.0/);
  assert.match(worker, /manifest\.webmanifest/);
  assert.match(worker, /hotel-les-chevaliers\.png/);
  assert.match(worker, /sowell-hotels\.png/);
});

test("the dashboard keeps the critical terrain safeguards", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /Classer toutes les restantes en Libre/);
  assert.match(page, /Sauvegarder le tableau en PDF/);
  assert.match(page, /À BLANC/);
  assert.match(page, /RECOUCHES/);
  assert.match(page, /LOCAL_STORAGE_PREFIX/);
  assert.match(page, /raccoon_days/);
  assert.doesNotMatch(page, /Tableau du jour · Samedi 1 août 2026/);
});

test("the cloud schema protects hotel data with RLS", async () => {
  const sql = await read("supabase/schema.sql");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /raccoon_is_admin/);
  assert.match(sql, /raccoon_admin_upsert_member/);
  assert.match(sql, /updated_by = \(select auth\.uid\(\)\)/);
});

test("Vercel uses the standard Next.js build", async () => {
  const vercel = JSON.parse(await read("vercel.json"));
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(vercel.framework, "nextjs");
  assert.equal(vercel.buildCommand, "npm run build:vercel");
  assert.equal(pkg.scripts["build:vercel"], "next build");
});
