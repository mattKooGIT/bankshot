"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizeFeed, type FeedEvent, type Reply } from "@/lib/feed";
import type { FormState } from "@/lib/forms";

export async function loadFeed(roomId: string, before?: string): Promise<FeedEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("room_feed", { p_room: roomId, p_before: before ?? null, p_limit: 30 });
  if (error) throw new Error(error.message);
  return normalizeFeed((data ?? []) as FeedEvent[]);
}

export async function postComment(roomId: string, text: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_comment", { p_room: roomId, p_text: text });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function toggleReaction(eventId: string, emoji: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("toggle_reaction", { p_event: Number(eventId), p_emoji: emoji });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function postReply(eventId: string, text: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_reply", { p_event: Number(eventId), p_text: text });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function loadReplies(eventId: string): Promise<Reply[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_replies", { p_event: Number(eventId) });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Reply[]).map((r) => ({ ...r, id: String(r.id) }));
}
