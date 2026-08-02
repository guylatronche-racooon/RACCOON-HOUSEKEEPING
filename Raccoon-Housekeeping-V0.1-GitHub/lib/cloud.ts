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

