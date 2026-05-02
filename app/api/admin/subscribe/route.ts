import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { subscribeApp, getSubscribedApps, whoAmI } from "@/lib/meta";
import type { Account } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");

  const sb = supabaseAdmin();
  let account: Account | null = null;
  if (accountId) {
    const { data } = await sb
      .from("accounts")
      .select("*")
      .eq("id", accountId)
      .maybeSingle<Account>();
    account = data ?? null;
  } else {
    const { data } = await sb
      .from("accounts")
      .select("*")
      .eq("active", true)
      .limit(1)
      .maybeSingle<Account>();
    account = data ?? null;
  }

  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const [me, subs, subscribed] = await Promise.all([
    whoAmI({ accessToken: account.ig_access_token }),
    getSubscribedApps({ accessToken: account.ig_access_token }),
    subscribeApp({ accessToken: account.ig_access_token }),
  ]);

  return NextResponse.json({
    account: { id: account.id, name: account.name, ig_business_id: account.ig_business_id },
    me,
    previous_subscriptions: subs,
    subscribe_result: subscribed,
  });
}
