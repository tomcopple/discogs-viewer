import re
import sqlite3
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib import error, request

DB_PATH = "data/collection.db"
CONCURRENCY = 12
TIMEOUT_SECONDS = 15


def to_rym_slug(value: str) -> str:
    if not value:
        return ""

    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.lower().replace("&", " and ")
    value = re.sub(r"['’]", "", value)
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"^-+|-+$", "", value)
    return value


def get_rym_album_url(artist: str, title: str) -> str:
    artist_slug = to_rym_slug(artist) or "unknown-artist"
    title_slug = to_rym_slug(title) or "unknown-album"
    return f"https://rateyourmusic.com/release/album/{artist_slug}/{title_slug}/"


def check_link(row: tuple[int, str, str]) -> dict:
    album_id, artist, title = row
    url = get_rym_album_url(artist, title)

    req = request.Request(
        url,
        method="GET",
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )

    try:
        with request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
            return {
                "id": album_id,
                "artist": artist,
                "title": title,
                "url": url,
                "status": response.getcode(),
                "final_url": response.geturl(),
            }
    except error.HTTPError as http_error:
        return {
            "id": album_id,
            "artist": artist,
            "title": title,
            "url": url,
            "status": http_error.code,
        }
    except Exception as network_error:
        return {
            "id": album_id,
            "artist": artist,
            "title": title,
            "url": url,
            "status": "NETWORK_ERR",
            "error": str(network_error),
        }


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, artist, title FROM collection").fetchall()
    conn.close()

    results = []

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = [pool.submit(check_link, row) for row in rows]
        for future in as_completed(futures):
            results.append(future.result())

    total = len(results)

    status_breakdown = {}
    for result in results:
        key = str(result["status"])
        status_breakdown[key] = status_breakdown.get(key, 0) + 1

    success = sum(
        1
        for result in results
        if isinstance(result["status"], int) and 200 <= result["status"] < 400
    )
    not_found = sum(1 for result in results if result["status"] == 404)
    other_failures = total - success - not_found

    print("--- RYM Link Test Summary ---")
    print(f"Total albums: {total}")
    print(f"Successful (2xx/3xx): {success}")
    print(f"404 Not Found: {not_found}")
    print(f"Other failures: {other_failures}")
    print(f"Status breakdown: {status_breakdown}")

    failed = [
        result
        for result in results
        if not (
            isinstance(result["status"], int) and 200 <= result["status"] < 400
        )
    ]

    if failed:
        print("\nSample failed links (first 15):")
        for result in failed[:15]:
            print(
                f"{result['status']} | {result['artist']} - {result['title']} | {result['url']}"
            )


if __name__ == "__main__":
    main()
