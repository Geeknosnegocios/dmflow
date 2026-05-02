export type Account = {
  id: string;
  name: string;
  ig_business_id: string;
  ig_username: string | null;
  ig_access_token: string;
  ig_page_id: string | null;
  app_id: string | null;
  app_secret: string;
  verify_token: string;
  active: boolean;
  ig_token_expires_at: string | null;
  ig_token_refreshed_at: string | null;
  notify_email: string | null;
  last_error_notified_at: string | null;
  outgoing_webhook_url: string | null;
  outgoing_webhook_secret: string | null;
  outgoing_webhook_events: string[];
  sentiment_filter_enabled: boolean;
  sentiment_min_confidence: number;
  created_at: string;
  updated_at: string;
};

export type MatchMode = "contains" | "exact" | "starts_with" | "any";
export type TriggerType = "comment" | "first_dm" | "story_reply";

export type DmButton = { url: string; title: string };

export type Rule = {
  id: string;
  account_id: string;
  name: string;
  post_id: string | null;
  story_id: string | null;
  keyword: string | null;
  match_mode: MatchMode;
  trigger_type: TriggerType;
  public_reply: string | null;
  dm_message: string;
  dm_button_url: string | null;
  dm_button_text: string | null;
  dm_buttons: DmButton[] | null;
  priority: number;
  active: boolean;
  triggered_count: number;
  variants: Array<{ message: string; buttons?: DmButton[] }> | null;
  variant_group: string | null;
  variant_hits: number[];
  variant_conversions: number[];
  followup_delay_hours: number | null;
  followup_message: string | null;
  followup_buttons: DmButton[] | null;
  test_mode: boolean;
  is_template: boolean;
  platform: string;
  created_at: string;
  updated_at: string;
};

export type Event = {
  id: string;
  account_id: string;
  rule_id: string | null;
  ig_comment_id: string;
  ig_media_id: string | null;
  ig_user_id: string | null;
  ig_username: string | null;
  comment_text: string | null;
  matched_keyword: string | null;
  public_reply_sent: boolean;
  public_reply_error: string | null;
  dm_sent: boolean;
  dm_error: string | null;
  raw_payload: unknown;
  platform: string;
  created_at: string;
};
