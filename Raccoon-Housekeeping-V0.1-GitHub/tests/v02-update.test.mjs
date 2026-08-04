import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migration-v0.2.sql", import.meta.url), "utf8");

test("V0.2 separates permanent settings from daily snapshots", () => {
  assert.match(page, /type PermanentCloudSnapshot/);
  assert.match(page, /raccoon_settings/);
  assert.match(page, /permanentSettingsStorageKey/);
  assert.match(page, /outOfServiceRooms/);
  assert.match(page, /employees: directory\.map\(employeeDirectoryRecord\)/);
  assert.match(migration, /create table if not exists public\.raccoon_settings/);
  assert.match(migration, /on conflict \(hotel_id\) do nothing/);
});

test("V0.2 keeps repaired incidents in the daily report", () => {
  assert.match(page, /technicalStatus === "Réparé"/);
  assert.match(page, /Boolean\(room\.alert\) \|\| room\.technicalStatus === "Réparé"/);
  assert.match(page, /alert: technicalStatus === "Réparé" \? undefined/);
  assert.match(page, /Photo jointe/);
});

test("V0.2 publishes PDFs automatically and uses the neutral account copy", () => {
  assert.match(page, /pdfEmployees\.forEach\(\(employee\) => generateIndividualPdf\(employee\)\)/);
  assert.match(page, /PDF généré/);
  assert.doesNotMatch(page, /Créer le compte administrateur/);
  assert.match(page, /Créer mon compte/);
});

test("V0.2 personnel screen is based on the permanent directory", () => {
  const personnelStart = page.indexOf("const renderPersonnel");
  const reportsStart = page.indexOf("const renderReports", personnelStart);
  const personnel = page.slice(personnelStart, reportsStart);
  assert.match(page, /writeEmployeeDirectory/);
  assert.match(personnel, /Référentiel permanent du personnel/);
  assert.match(personnel, /Horaires habituels/);
  assert.doesNotMatch(personnel, /Tâches annexes estimées/);
  assert.doesNotMatch(personnel, /personnel-annex-summary/);
});

test("V0.2 adds daily common-area checks with required details and technical photos", () => {
  assert.match(page, /Tableau des communs/);
  assert.match(page, /commonAreaDraft\.action === "Ménage"/);
  assert.match(page, /commonAreaErrors\.assignee/);
  assert.match(page, /commonAreaErrors\.minutes/);
  assert.match(page, /commonAreaErrors\.comment/);
  assert.match(page, /commonAreaDraft\.action === "Problème technique"/);
  assert.match(page, /technicalPhotoData/);
  assert.match(page, /> Contrôlé</);
});
