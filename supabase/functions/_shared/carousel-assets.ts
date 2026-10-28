const MAX_SLIDE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const BUCKET_PREFIX = "/storage/v1/object/public/dmflow-content/carrosseis/";

type CarouselAssetRow = {
  image_urls: string[];
  slide_hashes: string[];
};
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function verifyCarouselAssets({ row, storageUrl, fetchImpl = fetch }: {
  row: CarouselAssetRow;
  storageUrl: string;
  fetchImpl?: Fetcher;
}) {
  if (row.image_urls.length !== 8 || row.slide_hashes.length !== 8) {
    throw new Error("Carousel must contain eight approved slide assets");
  }
  const allowedOrigin = new URL(storageUrl).origin;
  let totalBytes = 0;
  for (let index = 0; index < row.image_urls.length; index += 1) {
    const url = new URL(row.image_urls[index]);
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.protocol !== "https:" || url.origin !== allowedOrigin || url.username || url.password ||
        url.search || url.hash || /%2f|%5c/i.test(url.pathname) ||
        decodedPath.split("/").includes("..") || decodedPath.includes("\\") ||
        !decodedPath.startsWith(BUCKET_PREFIX) || !decodedPath.toLowerCase().endsWith(".png")) {
      throw new Error(`Carousel slide ${index + 1} is outside the approved public storage path`);
    }

    const response = await fetchImpl(url, { method: "GET", redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Carousel slide ${index + 1} redirected`);
    }
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("image/png")) {
      throw new Error(`Carousel slide ${index + 1} is not an accessible PNG`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_SLIDE_BYTES) throw new Error(`Carousel slide ${index + 1} exceeds the size limit`);
    const bytes = await readBounded(response, MAX_SLIDE_BYTES);
    if (!isPng(bytes)) throw new Error(`Carousel slide ${index + 1} has invalid PNG bytes`);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Carousel assets exceed the total size limit");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const fingerprint = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (fingerprint !== row.slide_hashes[index]) throw new Error(`Carousel slide ${index + 1} hash does not match approval`);
  }
}

function isPng(bytes: Uint8Array) {
  return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
}

async function readBounded(response: Response, limit: number) {
  if (!response.body) throw new Error("Carousel image response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Carousel image exceeds the size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
