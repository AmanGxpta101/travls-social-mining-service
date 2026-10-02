import { randomBytes } from "node:crypto";
import { HttpException, HttpStatus } from "@nestjs/common";
import { env } from "../../env";

/**
 * Challenge images, in a public Supabase Storage bucket. Uploads and deletes
 * go through the REST API with the service_role key (server-side only);
 * reads are plain public URLs, so X, the host app and the ops dashboard can
 * all fetch them without credentials.
 */

// Stills only for now: X processes GIFs and video asynchronously after
// upload, and uploadMedia doesn't wait for that yet (see x-oauth.ts).
export const CHALLENGE_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
// X's cap for a still image.
export const CHALLENGE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function storageConfig() {
  const { url, serviceRoleKey, mediaBucket } = env.supabase;
  if (!url || !serviceRoleKey) {
    throw new HttpException("Supabase Storage is not configured", HttpStatus.INTERNAL_SERVER_ERROR);
  }
  return { url, serviceRoleKey, bucket: mediaBucket };
}

function authHeaders(serviceRoleKey: string) {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
}

/** Stores a challenge image and returns its public URL. */
export async function uploadChallengeImage(params: { taskId: string; buffer: Buffer; mimeType: string }): Promise<string> {
  const { url, serviceRoleKey, bucket } = storageConfig();
  const ext = CHALLENGE_IMAGE_TYPES[params.mimeType];
  // A fresh name per upload, so a replaced image is never served stale from a cache.
  const path = `${params.taskId}/${randomBytes(6).toString("hex")}.${ext}`;

  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(serviceRoleKey), "Content-Type": params.mimeType, "Cache-Control": "31536000" },
    body: new Uint8Array(params.buffer),
  });
  if (!res.ok) {
    throw new HttpException(`image upload failed: ${await res.text()}`, HttpStatus.BAD_GATEWAY);
  }
  return `${url}/storage/v1/object/public/${bucket}/${path}`;
}

/** Downloads a stored challenge image, e.g. to attach it to a KOL's post. */
export async function downloadChallengeImage(publicUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(publicUrl);
  if (!res.ok) {
    throw new HttpException(`couldn't fetch the challenge image (${res.status})`, HttpStatus.BAD_GATEWAY);
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    mimeType: res.headers.get("content-type")?.split(";")[0] ?? "image/png",
  };
}
