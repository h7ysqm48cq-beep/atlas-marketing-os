#!/usr/bin/env python3

import json
import sys
from urllib.request import urlopen
from urllib.error import HTTPError

API = "http://localhost:3001"


def get_json(url: str):
    with urlopen(url) as response:
        return json.loads(response.read().decode())


try:
    posts = get_json(f"{API}/automation/posts")
except Exception as e:
    print(f"Cannot connect to API: {e}")
    sys.exit(1)

facebook_posts = [
    p for p in posts
    if p.get("platform") == "FACEBOOK"
]

if not facebook_posts:
    print("No Facebook posts found.")
    sys.exit(0)

latest = facebook_posts[-1]

post_id = latest["id"]

print("=" * 60)
print("Latest Facebook Post")
print("=" * 60)
print(f"ID        : {post_id}")
print(f"Title     : {latest.get('title')}")
print(f"Status    : {latest.get('status')}")
print(f"Scheduled : {latest.get('scheduledAt')}")
print("=" * 60)

try:
    detail = get_json(
        f"{API}/automation/posts/{post_id}"
    )
except HTTPError as e:
    print(e.read().decode())
    sys.exit(1)

print(json.dumps(detail, indent=4))
