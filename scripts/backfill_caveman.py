"""
Backfill DMflow — Post Caveman
Manda o link do tutorial para todos que comentaram no post.

Janela Meta: DM privada só funciona dentro de 7 dias do comentário.
Fora da janela, só manda reply público.

Uso:
  python backfill_caveman.py [--dry-run] [--only-recent]
"""
import json
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone, timedelta

# ---------- config ----------
IG_TOKEN   = "IGAANrqbjy6ZAFBZAGJVSFBDeHItMlFZAek9nbDFWMlF1WDUyczFrVG0wcktCd2h5MFZAHY2JIc3ktU0NfbnFqOUtmS0hiUnp1TFQtNktORXlnc1J4eGJJbEJlNUMyQTRTa1hwTTRwNE8zWjRlT0R2SXozZADlOaFlSTklxcTE2YmhjYwZDZD"
SUPABASE_URL = "https://zoknypleoribwomifzgi.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpva255cGxlb3JpYndvbWlmemdpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQ5OTUzNSwiZXhwIjoyMDkxMDc1NTM1fQ.PRwnl7GGwfnnQD6CrzWy72L6wRElc7t4O9Gz1VJwk3E"
ACCOUNT_ID  = "b5371147-07f8-4fa8-9494-f8f22713d455"
RULE_ID     = "2beaea4a-9994-445d-88f8-3e228eb91924"

POST_ID     = "18125763628595504"  # instagram.com/p/DXjgKVyEiKZ/

IG_API      = "https://graph.instagram.com/v25.0"

PUBLIC_REPLY  = "Opa! Te mandei no direct 🔥"
DM_TEXT       = "Opa, {username}! 🎬 Aqui o tutorial que prometi:\n\nhttps://youtu.be/lrcHeEZEaNU?si=pFirDwbpTneyS2Fp\n\nAssiste e me conta o que achou! 🚀"
DM_BUTTON_URL  = "https://youtu.be/lrcHeEZEaNU?si=pFirDwbpTneyS2Fp"
DM_BUTTON_TEXT = "Assistir tutorial 🎬"


def http(url, method="GET", body=None, headers=None):
    headers = headers or {}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read() or b"{}")
        except Exception:
            err = {"error": {"message": str(e)}}
        return e.code, err


def ig_headers():
    return {"Authorization": f"Bearer {IG_TOKEN}"}


def sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept-Profile": "dmflow",
        "Content-Profile": "dmflow",
        "Prefer": "return=minimal",
    }


def list_all_comments(post_id):
    out = []
    url = f"{IG_API}/{post_id}/comments?fields=id,text,timestamp,username,from&limit=100"
    while url:
        status, data = http(url, headers=ig_headers())
        if status >= 400:
            print(f"[fetch comments error] {status} {data}")
            break
        out.extend(data.get("data", []))
        url = (data.get("paging") or {}).get("next")
    return out


def reply_public(comment_id, text):
    url = f"{IG_API}/{comment_id}/replies"
    return http(url, "POST", {"message": text}, ig_headers())


def send_dm(comment_id, username, btn_url, btn_text):
    url = f"{IG_API}/me/messages"
    text = DM_TEXT.replace("{username}", username or "")
    msg = {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "button",
                "text": text,
                "buttons": [
                    {"type": "web_url", "url": btn_url, "title": btn_text}
                ],
            },
        }
    }
    body = {"recipient": {"comment_id": comment_id}, "message": msg}
    return http(url, "POST", body, ig_headers())


def already_logged(comment_id):
    url = (
        f"{SUPABASE_URL}/rest/v1/events"
        f"?select=id&ig_comment_id=eq.{comment_id}&limit=1"
    )
    h = sb_headers().copy()
    h.pop("Prefer", None)
    h["Accept"] = "application/json"
    status, data = http(url, headers=h)
    return isinstance(data, list) and len(data) > 0


def log_event(c, reply_ok, reply_err, dm_ok, dm_err):
    url = f"{SUPABASE_URL}/rest/v1/events"
    username = c.get("username") or (c.get("from") or {}).get("username")
    body = {
        "account_id": ACCOUNT_ID,
        "rule_id": RULE_ID,
        "ig_comment_id": c["id"],
        "ig_media_id": POST_ID,
        "ig_user_id": (c.get("from") or {}).get("id"),
        "ig_username": username,
        "comment_text": c.get("text"),
        "matched_keyword": None,
        "public_reply_sent": reply_ok,
        "public_reply_error": reply_err,
        "dm_sent": dm_ok,
        "dm_error": dm_err,
        "raw_payload": {"backfill": True, "timestamp": c.get("timestamp")},
        "platform": "instagram",
    }
    return http(url, "POST", body, sb_headers())


def main():
    dry = "--dry-run" in sys.argv
    only_recent = "--only-recent" in sys.argv

    print(f"[info] Fetching comments from post {POST_ID}...")
    comments = list_all_comments(POST_ID)
    print(f"[info] {len(comments)} comments total")

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)

    def parse_ts(ts):
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))

    stats = {"skip_logged": 0, "reply_ok": 0, "reply_fail": 0,
             "dm_ok": 0, "dm_fail_window": 0, "dm_fail_other": 0}

    for i, c in enumerate(comments, 1):
        cid = c["id"]
        ts = parse_ts(c["timestamp"])
        within = ts > cutoff
        username = c.get("username") or (c.get("from") or {}).get("username") or "?"

        if only_recent and not within:
            continue

        if already_logged(cid):
            stats["skip_logged"] += 1
            continue

        prefix = f"[{i:03d}/{len(comments)}] @{username} ({ts.date()})"
        if dry:
            print(f"{prefix} DRY — would {'reply+DM' if within else 'reply only (fora da janela 7d)'}")
            continue

        # Reply público
        r_status, r_data = reply_public(cid, PUBLIC_REPLY)
        reply_ok = 200 <= r_status < 300
        reply_err = None if reply_ok else json.dumps(r_data)[:200]
        if reply_ok:
            stats["reply_ok"] += 1
        else:
            stats["reply_fail"] += 1

        # DM privada (só dentro da janela de 7 dias)
        dm_ok = False
        dm_err = None
        if within:
            d_status, d_data = send_dm(cid, username, DM_BUTTON_URL, DM_BUTTON_TEXT)
            dm_ok = 200 <= d_status < 300
            dm_err = None if dm_ok else json.dumps(d_data)[:200]
            if dm_ok:
                stats["dm_ok"] += 1
            else:
                stats["dm_fail_other"] += 1
                print(f"  [dm error] {dm_err}")
        else:
            stats["dm_fail_window"] += 1

        log_event(c, reply_ok, reply_err, dm_ok, dm_err)

        status_str = (
            f"reply={'ok' if reply_ok else 'fail'} "
            f"dm={'ok' if dm_ok else ('out-of-window' if not within else 'fail')}"
        )
        print(f"{prefix} {status_str}")
        time.sleep(1.2)  # rate limit safety

    print("\n[done]", json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
