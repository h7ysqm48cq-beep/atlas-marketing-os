#!/usr/bin/env python3

import json
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API = "http://localhost:3001"

BRAND_ID = "cmrwf5alg0001439kts6i5yhl"
FACEBOOK_CHANNEL_ID = "cmrz91li60001g79k0w4d7pvi"
TIMEZONE_NAME = "Asia/Kuala_Lumpur"


def api_request(method: str, path: str, body=None):
    url = API + path
    data = None

    if body is not None:
        data = json.dumps(body).encode("utf-8")

    request = Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )

    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")

            if not raw:
                return None

            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return raw

    except HTTPError as error:
        raw = error.read().decode("utf-8")
        print(f"HTTP {error.code}")

        try:
            print(json.dumps(json.loads(raw), indent=2))
        except json.JSONDecodeError:
            print(raw)

        sys.exit(1)

    except URLError as error:
        print(f"Cannot connect to Atlas API: {error.reason}")
        print("Make sure API is running with: npm run dev:api")
        sys.exit(1)


def pretty(value) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def get_latest_facebook_post():
    posts = api_request("GET", "/automation/posts")

    facebook_posts = [
        post
        for post in posts
        if post.get("platform") == "FACEBOOK"
    ]

    if not facebook_posts:
        return None

    facebook_posts.sort(
        key=lambda post: post.get("createdAt", "")
    )

    return facebook_posts[-1]


def latest() -> None:
    post = get_latest_facebook_post()

    if not post:
        print("No Facebook posts found.")
        return

    detail = api_request(
        "GET",
        f"/automation/posts/{post['id']}",
    )

    pretty(detail)


def channels() -> None:
    pretty(
        api_request(
            "GET",
            "/automation/channels",
        )
    )


def dashboard() -> None:
    pretty(
        api_request(
            "GET",
            "/automation/dashboard",
        )
    )


def settings() -> None:
    pretty(
        api_request(
            "GET",
            "/automation/settings",
        )
    )


def run_publisher() -> None:
    pretty(
        api_request(
            "POST",
            "/automation/run",
            {},
        )
    )


def facebook_test() -> None:
    pretty(
        api_request(
            "POST",
            "/automation/facebook/test",
            {},
        )
    )


def telegram_test() -> None:
    pretty(
        api_request(
            "POST",
            "/automation/telegram/test",
            {},
        )
    )


def create_post() -> None:
    scheduled_at = (
        datetime.now(timezone.utc)
        + timedelta(minutes=2)
    ).isoformat()

    body = {
        "brandId": BRAND_ID,
        "channelId": FACEBOOK_CHANNEL_ID,
        "platform": "FACEBOOK",
        "title": "Atlas CLI Facebook Test",
        "content": (
            "这是一篇由 Atlas CLI 建立的 Facebook "
            "自动排程测试贴文。✅"
        ),
        "mediaUrls": [],
        "scheduledAt": scheduled_at,
        "timezone": TIMEZONE_NAME,
        "status": "DRAFT",
    }

    post = api_request(
        "POST",
        "/automation/posts",
        body,
    )

    print("Post created:")
    pretty(post)

    print("")
    print(
        "Next command:"
    )
    print(
        f"python3 atlas.py queue {post['id']}"
    )


def queue_post(post_id: str) -> None:
    result = api_request(
        "POST",
        f"/automation/posts/{post_id}/queue",
        {},
    )

    pretty(result)


def delete_post(post_id: str) -> None:
    result = api_request(
        "DELETE",
        f"/automation/posts/{post_id}",
    )

    if result is None:
        print(f"Deleted post: {post_id}")
    else:
        pretty(result)


def health() -> None:
    checks = []

    try:
        root = api_request("GET", "/")
        checks.append(
            {
                "service": "API",
                "ok": True,
                "details": root,
            }
        )
    except SystemExit:
        checks.append(
            {
                "service": "API",
                "ok": False,
            }
        )
        pretty(checks)
        return

    facebook = api_request(
        "POST",
        "/automation/facebook/test",
        {},
    )

    checks.append(
        {
            "service": "Facebook",
            "ok": bool(
                facebook.get("connected")
            ),
            "details": facebook,
        }
    )

    telegram = api_request(
        "POST",
        "/automation/telegram/test",
        {},
    )

    checks.append(
        {
            "service": "Telegram",
            "ok": bool(
                telegram.get("connected")
            ),
            "details": telegram,
        }
    )

    channel_data = api_request(
        "GET",
        "/automation/channels",
    )

    connected_channels = [
        channel
        for channel in channel_data
        if channel.get("status") == "CONNECTED"
    ]

    checks.append(
        {
            "service": "Channels",
            "ok": len(connected_channels) > 0,
            "connectedCount": len(
                connected_channels
            ),
        }
    )

    setting_data = api_request(
        "GET",
        "/automation/settings",
    )

    checks.append(
        {
            "service": "Settings",
            "ok": bool(setting_data),
            "details": {
                "timezone": setting_data.get(
                    "timezone"
                ),
                "approvalRequired": setting_data.get(
                    "approvalRequired"
                ),
                "autoPublishEnabled": setting_data.get(
                    "autoPublishEnabled"
                ),
            },
        }
    )

    pretty(checks)


def show_help() -> None:
    print(
        """
Atlas CLI

Commands:

  python3 atlas.py health
  python3 atlas.py latest
  python3 atlas.py post
  python3 atlas.py queue <POST_ID>
  python3 atlas.py delete <POST_ID>
  python3 atlas.py run
  python3 atlas.py channels
  python3 atlas.py dashboard
  python3 atlas.py settings
  python3 atlas.py fbtest
  python3 atlas.py tgtest
"""
    )


def main() -> None:
    if len(sys.argv) < 2:
        show_help()
        return

    command = sys.argv[1]

    if command == "latest":
        latest()
    elif command == "post":
        create_post()
    elif command == "queue":
        if len(sys.argv) != 3:
            print(
                "Usage: python3 atlas.py queue <POST_ID>"
            )
            sys.exit(1)

        queue_post(sys.argv[2])

    elif command == "delete":
        if len(sys.argv) != 3:
            print(
                "Usage: python3 atlas.py delete <POST_ID>"
            )
            sys.exit(1)

        delete_post(sys.argv[2])

    elif command == "run":
        run_publisher()
    elif command == "channels":
        channels()
    elif command == "dashboard":
        dashboard()
    elif command == "settings":
        settings()
    elif command == "fbtest":
        facebook_test()
    elif command == "tgtest":
        telegram_test()
    elif command == "health":
        health()
    else:
        show_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
