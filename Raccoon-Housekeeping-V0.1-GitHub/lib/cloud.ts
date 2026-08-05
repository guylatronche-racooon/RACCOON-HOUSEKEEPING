"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type CloudContext = {
  hotelId: string;
  email: string;
  displayName: string;
  role: string;
  userId: string;
};

export type CloudMember = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  active: boolean;
  user_id: string | null;
};

export type CloudTechnicalWorkflow =
  | "detected"
  | "reported"
  | "in_progress"
  | "repaired"
  | "cancelled";

export type CloudTechnicalIncident = {
  id: number;
  hotelId: string;
  originKey: string | null;
  location: string;
  locationType: "room" | "common_area" | "zone";
  category: string;
  title: string;
  description: string;
  urgency: "urgent" | "non_urgent";
  workflowStatus: CloudTechnicalWorkflow;
  assignee: string | null;
  reporter: string;
  source: string;
  material: string | null;
  minutes: number;
  comment: string | null;
  photoKey: string | null;
  photoName: string | null;
  photoType: string | null;
  reportedForDate: string;
  createdAt: string;
  updatedAt: string;
  repairedAt: string | null;
};

export type CloudTechnicalActivity = {
  id: number;
  interventionId: number | null;
  action: string;
  detail: string;
  actor: string;
  sourceApp: string;
  fromStatus: CloudTechnicalWorkflow | null;
  toStatus: CloudTechnicalWorkflow | null;
  createdAt: string;
};

type TechnicalIncidentRow = {
  id: number;
  hotel_id: string;
  origin_key: string | null;
  location: string;
  location_type: "room" | "common_area" | "zone";
  category: string;
  title: string;
  description: string;
  urgency: "urgent" | "non_urgent";
  workflow_status: CloudTechnicalWorkflow;
  assignee: string | null;
  reporter: string;
  source: string;
  material: string | null;
  minutes: number;
  comment: string | null;
  photo_key: string | null;
  photo_name: string | null;
  photo_type: string | null;
  reported_for_date: string;
  created_at: string;
  updated_at: string;
  repaired_at: string | null;
};

const TECHNICAL_BUCKET = "raccotel-technique";
const TECHNICAL_INCIDENT_COLUMNS = [
  "id",
  "hotel_id",
  "origin_key",
  "location",
  "location_type",
  "category",
  "title",
  "description",
  "urgency",
  "workflow_status",
  "assignee",
  "reporter",
  "source",
  "material",
  "minutes",
  "comment",
  "photo_key",
  "photo_name",
  "photo_type",
  "reported_for_date",
  "created_at",
  "updated_at",
  "repaired_at",
].join(",");

function mapTechnicalIncident(row: TechnicalIncidentRow): CloudTechnicalIncident {
  return {
    id: row.id,
    hotelId: row.hotel_id,
    originKey: row.origin_key,
    location: row.location,
    locationType: row.location_type,
    category: row.category,
    title: row.title,
    description: row.description,
    urgency: row.urgency,
    workflowStatus: row.workflow_status,
    assignee: row.assignee,
    reporter: row.reporter,
    source: row.source,
    material: row.material,
    minutes: row.minutes,
    comment: row.comment,
    photoKey: row.photo_key,
    photoName: row.photo_name,
    photoType: row.photo_type,
    reportedForDate: row.reported_for_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    repairedAt: row.repaired_at,
  };
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "photo.jpg";
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)?.trim();

let browserClient: SupabaseClient | null | undefined;

export function cloudIsConfigured() {
  return Boolean(supabaseUrl && supabaseKey);
}

export function getCloudClient() {
  if (!cloudIsConfigured()) return null;
  if (browserClient !== undefined) return browserClient;
  browserClient = createClient(supabaseUrl!, supabaseKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      worker: true,
      heartbeatCallback: (status) => {
        if (status === "disconnected" || status === "timeout") {
          browserClient?.realtime.connect();
        }
      },
    },
  });
  return browserClient;
}

export async function resolveCloudContext(
  client: SupabaseClient,
  defaultHotelName: string,
): Promise<CloudContext> {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user?.email) {
    throw new Error("La session a expiré. Reconnecte-toi.");
  }

  const displayName = String(
    userData.user.user_metadata?.full_name
    ?? userData.user.user_metadata?.name
    ?? userData.user.email.split("@")[0],
  );

  const { data, error } = await client.rpc("raccoon_bootstrap_or_context", {
    p_display_name: displayName,
    p_hotel_name: defaultHotelName,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.hotel_id) {
    throw new Error("Ce compte n’est pas encore autorisé pour cet hôtel. Demande à un administrateur de l’ajouter.");
  }

  return {
    hotelId: String(row.hotel_id),
    email: userData.user.email,
    displayName: String(row.display_name || displayName),
    role: String(row.role || "Réception"),
    userId: userData.user.id,
  };
}

export async function listCloudMembers(client: SupabaseClient, hotelId: string) {
  const { data, error } = await client
    .from("raccoon_members")
    .select("id,email,display_name,role,active,user_id")
    .eq("hotel_id", hotelId)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CloudMember[];
}

export async function upsertCloudMember(
  client: SupabaseClient,
  member: { email: string; displayName: string; role: string; active: boolean },
) {
  const { data, error } = await client.rpc("raccoon_admin_upsert_member", {
    p_active: member.active,
    p_display_name: member.displayName,
    p_email: member.email.trim().toLowerCase(),
    p_role: member.role,
  });
  if (error) throw error;
  return data;
}

export async function listCloudTechnicalIncidents(
  client: SupabaseClient,
  hotelId: string,
) {
  const { data, error } = await client
    .from("raccotel_technique_interventions")
    .select(TECHNICAL_INCIDENT_COLUMNS)
    .eq("hotel_id", hotelId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as unknown as TechnicalIncidentRow[]).map(mapTechnicalIncident);
}

export async function listCloudTechnicalActivity(
  client: SupabaseClient,
  hotelId: string,
) {
  const { data, error } = await client
    .from("raccotel_technique_activity")
    .select("id,intervention_id,action,detail,actor,source_app,from_status,to_status,created_at")
    .eq("hotel_id", hotelId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    interventionId: row.intervention_id === null ? null : Number(row.intervention_id),
    action: String(row.action),
    detail: String(row.detail),
    actor: String(row.actor),
    sourceApp: String(row.source_app || "technique"),
    fromStatus: (row.from_status || null) as CloudTechnicalWorkflow | null,
    toStatus: (row.to_status || null) as CloudTechnicalWorkflow | null,
    createdAt: String(row.created_at),
  })) as CloudTechnicalActivity[];
}

export async function createCloudTechnicalIncident(
  client: SupabaseClient,
  context: CloudContext,
  input: {
    workDate: string;
    location: string;
    locationType: "room" | "common_area";
    title: string;
    description: string;
    photoKey?: string | null;
    photoName?: string | null;
    photoType?: string | null;
  },
) {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("raccotel_technique_interventions")
    .insert({
      hotel_id: context.hotelId,
      origin_key: `housekeeping:${input.workDate}:${input.locationType}:${input.location}:${crypto.randomUUID()}`,
      location: input.location,
      location_type: input.locationType,
      category: "Autre",
      title: input.title.trim() || "Problème technique",
      description: input.description.trim(),
      urgency: "non_urgent",
      status: "open",
      workflow_status: "detected",
      reporter: context.displayName,
      source: "housekeeping",
      photo_key: input.photoKey || null,
      photo_name: input.photoName || null,
      photo_type: input.photoType || null,
      reported_for_date: input.workDate,
      created_by: context.userId,
      updated_by: context.userId,
      updated_from: "housekeeping",
      created_at: now,
      updated_at: now,
    })
    .select(TECHNICAL_INCIDENT_COLUMNS)
    .single();
  if (error) throw error;
  return mapTechnicalIncident(data as unknown as TechnicalIncidentRow);
}

export async function updateCloudTechnicalIncident(
  client: SupabaseClient,
  context: CloudContext,
  incidentId: number,
  changes: {
    workflowStatus?: CloudTechnicalWorkflow;
    title?: string;
    description?: string;
    photoKey?: string | null;
    photoName?: string | null;
    photoType?: string | null;
  },
) {
  const now = new Date().toISOString();
  const workflowStatus = changes.workflowStatus;
  const patch: Record<string, unknown> = {
    updated_at: now,
    updated_by: context.userId,
    updated_from: "housekeeping",
  };
  if (workflowStatus) {
    patch.workflow_status = workflowStatus;
    patch.status = ["repaired", "cancelled"].includes(workflowStatus) ? "repaired" : "open";
    patch.repaired_at = ["repaired", "cancelled"].includes(workflowStatus) ? now : null;
  }
  if (typeof changes.title === "string") patch.title = changes.title.trim() || "Problème technique";
  if (typeof changes.description === "string") patch.description = changes.description.trim();
  if ("photoKey" in changes) patch.photo_key = changes.photoKey || null;
  if ("photoName" in changes) patch.photo_name = changes.photoName || null;
  if ("photoType" in changes) patch.photo_type = changes.photoType || null;

  const { data, error } = await client
    .from("raccotel_technique_interventions")
    .update(patch)
    .eq("hotel_id", context.hotelId)
    .eq("id", incidentId)
    .select(TECHNICAL_INCIDENT_COLUMNS)
    .single();
  if (error) throw error;
  return mapTechnicalIncident(data as unknown as TechnicalIncidentRow);
}

export async function uploadCloudTechnicalPhoto(
  client: SupabaseClient,
  hotelId: string,
  file: File,
) {
  const key = `${hotelId}/interventions/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error } = await client.storage.from(TECHNICAL_BUCKET).upload(key, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return { key, name: file.name, type: file.type };
}

export async function getCloudTechnicalPhotoUrl(
  client: SupabaseClient,
  key: string,
) {
  const { data, error } = await client.storage.from(TECHNICAL_BUCKET).createSignedUrl(key, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
