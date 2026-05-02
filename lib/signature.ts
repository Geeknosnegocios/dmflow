import crypto from "crypto";

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
