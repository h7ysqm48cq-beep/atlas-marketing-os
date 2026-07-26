#!/usr/bin/env python3

import json
import sys
from collections import defaultdict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API = "http://localhost:3001"


def request(method: str, path: str, body=None):
    data = None

    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = Request(
        API + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )

    try:
        with urlopen(req, timeout=15) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None

    except HTTPError as error:
        raw = error.read().decode("utf-8")
        print(f"HTTP {error.code}: {raw}", file=sys.stderr)
        sys.exit(1)

    except URLError as error:
        print(
            f"Cannot connect to Atlas API: {error.reason}",
            file=sys.stderr,
        )
        sys.exit(1)


def main():
    histories = request("GET", "/history")
    posts = request("GET", "/automation/posts")

    posts_by_history = defaultdict(list)

    for post in posts:
        history_id = post.get("historyId")

        if history_id:
            posts_by_history[history_id].append(post)

    repaired = 0
    skipped = 0

    for history in histories:
        history_id = history["id"]
        linked_posts = posts_by_history.get(history_id, [])

        if not linked_posts:
            continue

        active_posts = [
            post
            for post in linked_posts
            if post.get("status") != "CANCELLED"
        ]

        if not active_posts:
            continue

        all_published = all(
            post.get("status") == "PUBLISHED"
            for post in active_posts
        )

        if (
            all_published
            and history.get("status") != "PUBLISHED"
        ):
            result = request(
                "PATCH",
                f"/history/{history_id}/status",
                {
                    "status": "PUBLISHED",
                    "reviewedBy": "Atlas Publisher Repair",
                },
            )

            print(
                f"REPAIRED: {history.get('topic')} "
                f"({history_id}) → {result.get('status')}"
            )
            repaired += 1
        else:
            statuses = ", ".join(
                f"{post.get('platform')}={post.get('status')}"
                for post in active_posts
            )

            print(
                f"SKIPPED : {history.get('topic')} "
                f"[{statuses}]"
            )
            skipped += 1

    print("")
    print(f"Repaired: {repaired}")
    print(f"Skipped : {skipped}")


if __name__ == "__main__":
    main()
