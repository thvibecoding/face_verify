import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const API_BASE = "/api";

export async function createVerifyLink(
  personId: string,
  referenceFaceBase64: string,
): Promise<{
  success: boolean;
  taskId?: string;
  sessionId?: string;
  sessionUrl?: string;
  kycProfileId?: string;
  error?: string;
}> {
  const resp = await fetch(`${API_BASE}/create-verify-link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ personId, referenceFaceBase64 }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    return { success: false, error: data.error || "请求失败" };
  }
  return data;
}

export async function checkVerifyStatus(
  sessionId: string,
): Promise<{
  success: boolean;
  status?: string;
  finishedAt?: string;
  imageUrl?: string | null;
  transactionId?: string | null;
  decision?: string | null;
  error?: string;
}> {
  const resp = await fetch(
    `${API_BASE}/check-verify-status?sessionId=${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
    },
  );
  const data = await resp.json();
  if (!resp.ok) {
    return { success: false, error: data.error || "请求失败" };
  }
  return data;
}

export async function getSignedImageUrl(
  path: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("person-documents")
    .createSignedUrl(path, 3600);
  if (error || !data.signedUrl) return null;
  return data.signedUrl;
}
