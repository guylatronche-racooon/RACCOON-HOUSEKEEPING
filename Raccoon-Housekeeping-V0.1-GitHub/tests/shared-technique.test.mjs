import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, cloud, migration] = await Promise.all([
  read("app/page.tsx"),
  read("lib/cloud.ts"),
  read("supabase/migration-v0.3-shared-technique.sql"),
]);

test("Housekeeping and Technique use one tenant-scoped intervention register", () => {
  assert.match(cloud, /from\("raccotel_technique_interventions"\)/);
  assert.match(cloud, /from\("raccotel_technique_activity"\)/);
  assert.match(cloud, /hotel_id: context\.hotelId/);
  assert.match(cloud, /updated_by: context\.userId/);
  assert.match(cloud, /updated_from: "housekeeping"/);
  assert.match(page, /raccotel_technique_interventions/);
  assert.match(page, /raccotel_technique_activity/);
  assert.match(page, /postgres_changes/);
});

test("Housekeeping keeps the Technique live connection healthy without a manual refresh", () => {
  assert.match(cloud, /worker:\s*true/);
  assert.match(cloud, /heartbeatCallback/);
  assert.match(cloud, /browserClient\?\.realtime\.connect\(\)/);
  assert.match(page, /subscribe\(\(status, error\) =>/);
  assert.match(page, /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT" \|\| status === "CLOSED"/);
  assert.match(page, /document\.addEventListener\("visibilitychange", handleResume\)/);
  assert.match(page, /window\.addEventListener\("focus", reconnectAndRefresh\)/);
  assert.match(page, /window\.addEventListener\("online", reconnectAndRefresh\)/);
  assert.match(page, /window\.setInterval\([\s\S]*45_000\)/);
});

test("the shared workflow carries status, history and private photos both ways", () => {
  assert.match(cloud, /"detected"[\s\S]*"reported"[\s\S]*"in_progress"[\s\S]*"repaired"[\s\S]*"cancelled"/);
  assert.match(cloud, /createSignedUrl\(key, 60 \* 60\)/);
  assert.match(cloud, /\$\{hotelId\}\/interventions\//);
  assert.match(page, /Suivi commun Occaris/);
  assert.match(page, /className="technical-history"/);
  assert.match(page, /Signalement technique annulé dans les deux applications/);
  assert.match(page, /Housekeeping et Technique synchronisés/);
});

test("the shared register stays authoritative after the Housekeeping day snapshot loads", () => {
  assert.match(page, /\[hydrated, technicalIncidents, workDate\]/);
  assert.match(page, /currentRoomIncident\s*\?\s*technicalStatusForWorkflow\[currentRoomIncident\.workflowStatus\]/s);
  assert.match(page, /currentCommonAreaIncident\s*\?\s*technicalStatusForWorkflow\[currentCommonAreaIncident\.workflowStatus\]/s);
  assert.match(page, /currentRoom\.alert === "Problème technique" \|\| currentRoomIncident/);
});

test("saving details cannot overwrite a status already changed by Technique", () => {
  const roomSave = page.slice(
    page.indexOf("const saveRoomTechnicalDetails"),
    page.indexOf("const openCommonArea"),
  );
  const commonSave = page.slice(
    page.indexOf("const saveCommonArea"),
    page.indexOf("const closeCommonArea"),
  );
  assert.doesNotMatch(roomSave, /workflowStatus:/);
  assert.doesNotMatch(commonSave, /workflowStatus:/);
});

test("the migration imports existing Housekeeping incidents without duplication", () => {
  assert.match(migration, /jsonb_array_elements\(coalesce\(d\.payload->'rooms'/);
  assert.match(migration, /jsonb_array_elements\(coalesce\(d\.payload->'commonAreas'/);
  assert.match(migration, /unique \(hotel_id, origin_key\)/i);
  assert.match(migration, /on conflict \(hotel_id, origin_key\)/i);
  assert.match(migration, /reported_for_date/);
});

test("the common register and files are protected per hotel", () => {
  assert.match(migration, /alter table public\.raccotel_technique_interventions enable row level security/i);
  assert.match(migration, /alter table public\.raccotel_technique_activity enable row level security/i);
  assert.match(migration, /hotel_id = \(select public\.raccoon_current_hotel_id\(\)\)/);
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /updated_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /revoke all on public\.raccotel_technique_interventions from public, anon, authenticated/i);
  assert.match(migration, /grant update \([\s\S]*updated_by[\s\S]*\) on public\.raccotel_technique_interventions to authenticated/i);
  assert.doesNotMatch(migration, /grant (?:all|delete|truncate).*raccotel_technique_interventions.*authenticated/i);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\].*raccoon_current_hotel_id\(\)/s);
  assert.match(migration, /storage\.foldername\(name\)\)\[2\] = 'interventions'/);
});

test("the database owns immutable audit history and publishes both tables in realtime", () => {
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /after insert or update on public\.raccotel_technique_interventions/i);
  assert.match(migration, /grant select on public\.raccotel_technique_activity to authenticated/i);
  assert.doesNotMatch(migration, /grant insert on public\.raccotel_technique_activity to authenticated/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.raccotel_technique_interventions/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.raccotel_technique_activity/i);
});
