#!/usr/bin/env python3

import json
import statistics
import subprocess
import time
from pathlib import Path

RUNS = 5
URL = "http://localhost:3001/ai/generate"

payload = {
    "topic": "世界杯怀旧内容，引起马来西亚华人讨论",
    "platforms": ["Facebook"],
    "style": "Nostalgia",
    "language": "Chinese",
}

times = []
statuses = []

for index in range(1, RUNS + 1):
    output_path = Path(
        f"/tmp/atlas-benchmark-{index}.json"
    )

    started = time.perf_counter()

    result = subprocess.run(
        [
            "curl",
            "-sS",
            "--max-time",
            "180",
            "-o",
            str(output_path),
            "-w",
            "%{http_code}",
            URL,
            "-H",
            "Content-Type: application/json",
            "--data-raw",
            json.dumps(
                payload,
                ensure_ascii=False,
            ),
        ],
        capture_output=True,
        text=True,
    )

    elapsed = time.perf_counter() - started
    status = result.stdout.strip()

    times.append(elapsed)
    statuses.append(status)

    print(
        f"Run {index}: "
        f"HTTP {status} · "
        f"{elapsed:.3f}s"
    )

print()
print("===== ATLAS BENCHMARK =====")
print(f"Runs: {RUNS}")
print(f"Average: {statistics.mean(times):.3f}s")
print(f"Median: {statistics.median(times):.3f}s")
print(f"Fastest: {min(times):.3f}s")
print(f"Slowest: {max(times):.3f}s")

if all(status == "201" for status in statuses):
    print("Status: PASS")
else:
    print("Status: CHECK FAILED REQUESTS")
