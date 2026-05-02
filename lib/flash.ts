import { cookies } from "next/headers";

type FlashKind = "success" | "error" | "info" | "warn";

export type Flash = {
  kind: FlashKind;
  message: string;
};

const COOKIE = "dmflow_flash";
const NEW_KEY_COOKIE = "dmflow_new_key";

export async function setFlash(flash: Flash) {
  const store = await cookies();
  store.set(COOKIE, JSON.stringify(flash), {
    path: "/",
    maxAge: 10,
    httpOnly: false,
    sameSite: "lax",
  });
}

export async function setNewKey(fullKey: string) {
  const store = await cookies();
  store.set(NEW_KEY_COOKIE, fullKey, {
    path: "/",
    maxAge: 120,
    httpOnly: false,
    sameSite: "lax",
  });
}

export async function readAndClearNewKey(): Promise<string | null> {
  const store = await cookies();
  const val = store.get(NEW_KEY_COOKIE)?.value ?? null;
  if (val) try { store.delete(NEW_KEY_COOKIE); } catch { /* expires in 120s */ }
  return val;
}

export async function readAndClearFlash(): Promise<Flash | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try { store.delete(COOKIE); } catch { /* read-only context; maxAge:10 expires it */ }
  try {
    return JSON.parse(raw) as Flash;
  } catch {
    return null;
  }
}
