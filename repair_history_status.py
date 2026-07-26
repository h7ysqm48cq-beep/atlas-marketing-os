#!/usr/bin/env python3

import json
import sys
from collections import defaultdict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_BASE_URL = "http://localhost:3001"


def api_request(method: str, path: str, body=None):
    payload = None

    if body is not None:
        payload = json.dumps(body).encode("utf-8")

    request = Request(
        API_BASE_URL + path,
        data=payload,
        method=method,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None

    except HTTPError as error:
        raw = error.read().decode("utf-8")
        print(
            f"HTTP {error.code}: {raw}",
            file=sys.stderr,
        )
        sys.exit(1)

    except URLError as error:
        print(
            f"Unable to connect to Atlas API: {error.reason}",
            file=sys.stderr,
        )
        print(
            "Start the API first with: npm run dev:api",
            file=sys.stderr,
        )
        sys.exit(1)


def main():
    histories = api_request("GET", "/history")
    posts = api_request("GET", "/automation/posts")

    posts_by_history = defaultdict(list)

    for post in posts:
        history_id = post.get("historyId")

        if history_id:
            posts_by_history[history_id].append(post)

    repaired = 0
    already_correct = 0
    incomplete = 0
    unlinked = 0

    for history in histories:
        history_id = history["id"]
        linked_posts = posts_by_history.get(history_id, [])

        if not linked_posts:
            unlinked += 1
            continue

        relevant_posts = [
            post
            for post in linked_posts
            if post.get("status") != "CANCELLED"
        ]

        if not relevant_posts:
            incomplete += 1
            continue

        all_published = all(
            post.get("status") == "PUBLISHED"
            for post in relevant_posts
        )

        if not all_published:
            statuses = ", ".join(
                f"{post.get('platform')}={post.get('status')}"
                for post in relevant_posts
            )

            print(
                f"WAITING  {history.get('topic')} "
                f"[{statuses}]"
            )
            incomplete += 1
            continue

        if history.get("status") == "PUBLISHED":
            already_correct += 1
            continue

        result = api_request(
            "PATCH",
            f"/history/{history_id}/status",
            {
                "status": "PUBLISHED",
                "reviewedBy": "Atlas Publisher",
            },
        )

        print(
            f"REPAIRED {history.get('topic')} "
            f"→ {result.get('status')}"
        )

        repaired += 1

    print("")
    print("Repair summary")
    print(f"Repaired       : {repaired}")
    print(f"Already correct: {already_correct}")
    print(f"Still waiting  : {incomplete}")
    print(f"No linked posts: {unlinked}")


if __name__ == "__main__":
    main()
