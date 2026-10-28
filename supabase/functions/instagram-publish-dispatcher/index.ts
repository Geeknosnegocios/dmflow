import { createClient } from "@supabase/supabase-js";
import { createInstagramPublishDispatcher, type Lane } from "./handler.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const config = {
  supabaseUrl: env("SUPABASE_URL"),
  serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  dispatcherTokenSha256: env("INSTAGRAM_DISPATCHER_TOKEN_SHA256"),
};

function repository() {
  const supabase: any = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async claim(now: number) {
      const { data, error } = await supabase.schema("dmflow").rpc("claim_instagram_dispatcher_tick", {
        p_now: new Date(now).toISOString(),
      }).maybeSingle();
      if (error) throw error;
      if (!data?.claim_token || !data?.lane) return null;
      return { claim_token: data.claim_token as string, lane: data.lane as Lane };
    },
    async release(token: string, now: number) {
      const { data, error } = await supabase.schema("dmflow").rpc("release_instagram_dispatcher_tick", {
        p_claim_token: token, p_now: new Date(now).toISOString(),
      });
      if (error) throw error;
      return data === true;
    },
  };
}

Deno.serve((request) => createInstagramPublishDispatcher({ config, repository })(request));
