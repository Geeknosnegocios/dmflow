import { createHash } from "node:crypto";
import type { ReelRow } from "../_shared/reel-publishing.ts";

const VIDEO_LIMIT = 256 * 1024 * 1024;
const COVER_LIMIT = 10 * 1024 * 1024;

function allowedMediaUrl(raw: string, supabaseUrl: string) {
  const expected = new URL(supabaseUrl);
  const actual = new URL(raw);
  if (actual.protocol !== "https:" || actual.origin !== expected.origin || actual.search || actual.hash ||
      !actual.pathname.startsWith("/storage/v1/object/public/dmflow-content/")) {
    throw new Error("Media URL is outside the approved Geek Academy bucket");
  }
  return actual;
}

async function verifiedBytes(raw: string, expectedHash: string, supabaseUrl: string, maxBytes: number, kind: "video" | "image") {
  if (!/^sha256:[0-9a-f]{64}$/i.test(expectedHash)) throw new Error("Approved asset hash is invalid");
  const response = await fetch(allowedMediaUrl(raw, supabaseUrl), {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Approved media returned HTTP ${response.status}`);
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (kind === "video" && mime !== "video/mp4") throw new Error("Approved Reel media must be video/mp4");
  if (kind === "image" && !["image/jpeg", "image/png"].includes(mime)) throw new Error("Approved cover must be JPEG or PNG");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Approved media exceeds the size limit");
  if (!response.body) throw new Error("Approved media response has no body");
  const reader = response.body.getReader();
  const digest = createHash("sha256");
  let size = 0;
  let signature = new Uint8Array();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Approved media exceeds the size limit");
    }
    digest.update(value);
    if (signature.byteLength < 12) {
      const required = 12 - signature.byteLength;
      const next = new Uint8Array(Math.min(12, signature.byteLength + value.byteLength));
      next.set(signature);
      next.set(value.slice(0, required), signature.byteLength);
      signature = next;
    }
  }
  if (size === 0) throw new Error("Approved media is empty");
  if (kind === "video" && !(signature.length >= 8 && new TextDecoder().decode(signature.slice(4, 8)) === "ftyp")) {
    throw new Error("Approved Reel asset has no MP4 ftyp signature");
  }
  if (kind === "image" && !(signature[0] === 0xff && signature[1] === 0xd8 ||
      signature[0] === 0x89 && new TextDecoder().decode(signature.slice(1, 4)) === "PNG")) {
    throw new Error("Approved cover has no supported image signature");
  }
  const actualHash = `sha256:${digest.digest("hex")}`;
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error("Approved media bytes differ from the owner-approved hash");
}

export async function verifyReelAssets(row: ReelRow, supabaseUrl: string) {
  await verifiedBytes(row.video_url, row.video_sha256, supabaseUrl, VIDEO_LIMIT, "video");
  await verifiedBytes(row.cover_url, row.cover_sha256, supabaseUrl, COVER_LIMIT, "image");
}

export async function verifyStoryAsset(row: ReelRow, supabaseUrl: string) {
  if (!row.story_url || !row.story_sha256) throw new Error("Approved Story video or hash is missing");
  await verifiedBytes(row.story_url, row.story_sha256, supabaseUrl, VIDEO_LIMIT, "video");
}

