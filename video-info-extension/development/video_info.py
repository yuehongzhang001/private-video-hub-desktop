import argparse
import json
import re
import sys
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.metas = []
        self.iframes = []
        self.videos = []
        self.links = []
        self.images = []
        self.titles = []
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        tag = tag.lower()
        if tag == "meta":
            key = d.get("property") or d.get("name") or d.get("itemprop")
            content = d.get("content")
            if key and content:
                self.metas.append((key.strip(), content.strip()))
        elif tag == "iframe":
            src = d.get("src")
            if src:
                self.iframes.append(src.strip())
        elif tag == "video":
            poster = d.get("poster")
            if poster:
                self.videos.append(poster.strip())
        elif tag == "link":
            rel = d.get("rel")
            href = d.get("href")
            if rel and href:
                self.links.append((str(rel).strip(), href.strip()))
        elif tag == "img":
            src = d.get("src") or d.get("data-src")
            if src:
                self.images.append((src.strip(), d.get("class", "")))
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            text = data.strip()
            if text:
                self.titles.append(text)


def fetch_html(url):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req) as resp:
        data = resp.read()
        charset = resp.headers.get_content_charset() or "utf-8"
        html = data.decode(charset, errors="replace")
        return html, resp.geturl()


def normalize_url(raw, base):
    if not raw:
        return None
    raw = raw.strip()
    if not raw:
        return None
    if "," in raw or " " in raw:
        raw = raw.split(",")[0].split()[0]
    return urljoin(base, raw)


def add_candidate(candidates, base, raw, score, reason):
    url = normalize_url(raw, base)
    if not url:
        return
    candidates.append({"url": url, "score": score, "reason": reason})


def add_text_candidate(candidates, text, score, reason):
    value = (text or "").strip()
    if value:
        value = re.sub(r"\s+", " ", unescape(value)).strip()
    if not value:
        return
    candidates.append({"value": value, "score": score, "reason": reason})


def extract_json_ld(html):
    blobs = re.findall(
        r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        html,
        flags=re.I | re.S,
    )
    items = []
    for blob in blobs:
        data = blob.strip()
        if not data:
            continue
        try:
            items.append(json.loads(data))
        except Exception:
            continue
    return items


def iter_video_objects(obj):
    if isinstance(obj, dict):
        types = obj.get("@type") or obj.get("type")
        if isinstance(types, list):
            if any(str(t).lower() == "videoobject" for t in types):
                yield obj
        elif isinstance(types, str) and types.lower() == "videoobject":
            yield obj
        graph = obj.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                yield from iter_video_objects(item)
    elif isinstance(obj, list):
        for item in obj:
            yield from iter_video_objects(item)


def pick_best_thumbnail(base_url, parser, html):
    meta_candidates = []
    other_candidates = []

    for key, content in parser.metas:
        k = key.lower()
        if k in ("og:image", "og:image:url"):
            add_candidate(meta_candidates, base_url, content, 90, k)
        elif k == "og:image:secure_url":
            add_candidate(meta_candidates, base_url, content, 88, k)
        elif k in ("twitter:image", "twitter:image:src"):
            add_candidate(meta_candidates, base_url, content, 80, k)
        elif k in ("thumbnail", "thumbnailurl", "thumbnail_url"):
            add_candidate(meta_candidates, base_url, content, 85, k)
        elif k == "image":
            add_candidate(meta_candidates, base_url, content, 50, k)

    for rel, href in parser.links:
        rel_l = rel.lower()
        if "image_src" in rel_l:
            add_candidate(other_candidates, base_url, href, 75, "link:rel=image_src")

    for poster in parser.videos:
        add_candidate(other_candidates, base_url, poster, 70, "video:poster")

    for src, cls in parser.images:
        cls_l = str(cls).lower()
        if "thumb" in cls_l or "poster" in cls_l:
            add_candidate(other_candidates, base_url, src, 35, "img:class")

    for obj in extract_json_ld(html):
        for video in iter_video_objects(obj):
            thumb = video.get("thumbnailUrl") or video.get("thumbnailURL") or video.get("thumbnail")
            if isinstance(thumb, list):
                for t in thumb:
                    add_candidate(other_candidates, base_url, t, 95, "jsonld:thumbnailUrl")
            else:
                add_candidate(other_candidates, base_url, thumb, 95, "jsonld:thumbnailUrl")

    candidates = meta_candidates + other_candidates
    if not candidates:
        return None, [], None

    if meta_candidates:
        best = max(meta_candidates, key=lambda c: c["score"])
        return best, candidates, "meta"

    best = max(other_candidates, key=lambda c: c["score"])
    return best, candidates, "body"


def pick_best_title(parser, html):
    meta_candidates = []
    other_candidates = []
    site_names = set()

    for key, content in parser.metas:
        k = key.lower()
        if k == "og:title":
            add_text_candidate(meta_candidates, content, 90, k)
        elif k == "twitter:title":
            add_text_candidate(meta_candidates, content, 85, k)
        elif k in ("title", "headline", "name"):
            add_text_candidate(meta_candidates, content, 70, k)
        elif k in ("og:site_name", "application-name", "site_name"):
            if content:
                site_names.add(normalize_text(content).lower())

    for text in parser.titles:
        title_text = normalize_text(text)
        parts = split_title_parts(title_text, site_names)
        if parts:
            add_text_candidate(other_candidates, parts[0], 60, "title:tag:trimmed")
        else:
            add_text_candidate(other_candidates, title_text, 60, "title:tag")

    for obj in extract_json_ld(html):
        for video in iter_video_objects(obj):
            name = video.get("name") or video.get("headline")
            add_text_candidate(other_candidates, name, 95, "jsonld:name")

    candidates = meta_candidates + other_candidates
    if not candidates:
        return None, [], None

    if meta_candidates:
        best = max(meta_candidates, key=lambda c: c["score"])
        return best, candidates, "meta"

    best = max(other_candidates, key=lambda c: c["score"])
    return best, candidates, "body"


def pick_best_duration(parser, html):
    meta_candidates = []
    other_candidates = []

    for key, content in parser.metas:
        k = key.lower()
        if k in ("og:video:duration", "video:duration"):
            add_text_candidate(meta_candidates, content, 90, k)
        elif k in ("duration", "twitter:player:stream:duration"):
            add_text_candidate(meta_candidates, content, 80, k)

    for obj in extract_json_ld(html):
        for video in iter_video_objects(obj):
            duration = video.get("duration")
            add_text_candidate(other_candidates, duration, 95, "jsonld:duration")

    candidates = meta_candidates + other_candidates
    if not candidates:
        return None, [], None

    if meta_candidates:
        best = max(meta_candidates, key=lambda c: c["score"])
        return best, candidates, "meta"

    best = max(other_candidates, key=lambda c: c["score"])
    return best, candidates, "body"


def parse_duration_seconds(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    iso_match = re.match(
        r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+(?:\.\d+)?)S)?)?$",
        text,
        flags=re.I,
    )
    if iso_match:
        days = int(iso_match.group("days") or 0)
        hours = int(iso_match.group("hours") or 0)
        minutes = int(iso_match.group("minutes") or 0)
        seconds = float(iso_match.group("seconds") or 0)
        return days * 86400 + hours * 3600 + minutes * 60 + seconds

    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return float(text)

    if ":" in text:
        parts = text.split(":")
        if 2 <= len(parts) <= 3 and all(p.strip().isdigit() or re.fullmatch(r"\d+(?:\.\d+)?", p.strip()) for p in parts):
            parts = [float(p.strip()) for p in parts]
            if len(parts) == 2:
                minutes, seconds = parts
                return minutes * 60 + seconds
            hours, minutes, seconds = parts
            return hours * 3600 + minutes * 60 + seconds

    return None


def format_duration(seconds):
    if seconds is None:
        return None
    total = int(round(seconds))
    if total < 0:
        return None
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def normalize_duration(value):
    seconds = parse_duration_seconds(value)
    if seconds is None:
        return value
    return format_duration(seconds)


def normalize_text(value):
    if not value:
        return ""
    text = re.sub(r"\s+", " ", unescape(str(value))).strip()
    return text


def split_title_parts(title_text, site_names):
    if not title_text:
        return []
    parts = [title_text]
    for sep in (" | ", " - ", " :: ", " / ", " : "):
        if sep in title_text:
            parts = [p.strip() for p in title_text.split(sep) if p.strip()]
            break
    if not parts:
        return []
    if site_names:
        filtered = [
            p for p in parts if normalize_text(p).lower() not in site_names
        ]
        if filtered:
            parts = filtered
    return parts


def pick_best_iframe(page_url, iframes):
    if not iframes:
        return None
    base_host = urlparse(page_url).netloc.lower()
    scored = []
    for src in iframes:
        abs_src = normalize_url(src, page_url)
        if not abs_src:
            continue
        score = 0
        low = abs_src.lower()
        if "embed" in low:
            score += 10
        if "player" in low:
            score += 5
        if urlparse(abs_src).netloc.lower() == base_host:
            score += 8
        scored.append((score, abs_src))
    if not scored:
        return None
    scored.sort(key=lambda s: s[0], reverse=True)
    return scored[0][1]


def main():
    parser = argparse.ArgumentParser(
        description="Extract likely playing-video thumbnail, iframe, title, and duration from a page"
    )
    parser.add_argument("url", help="Video page URL")
    parser.add_argument("--verbose", action="store_true", help="Include all candidates")
    args = parser.parse_args()

    try:
        html, final_url = fetch_html(args.url)
    except Exception as exc:
        print(f"error: failed to fetch url: {exc}", file=sys.stderr)
        return 2

    page_parser = PageParser()
    page_parser.feed(html)

    best, candidates, thumb_source = pick_best_thumbnail(final_url, page_parser, html)
    title, title_candidates, title_source = pick_best_title(page_parser, html)
    duration, duration_candidates, duration_source = pick_best_duration(page_parser, html)
    iframe = pick_best_iframe(final_url, page_parser.iframes)

    result = {
        "url": final_url,
        "thumbnail": best["url"] if best else None,
        "title": title["value"] if title else None,
        "duration": normalize_duration(duration["value"]) if duration else None,
        "iframe": iframe,
    }
    if args.verbose:
        result["candidates"] = sorted(
            candidates, key=lambda c: c["score"], reverse=True
        )
        result["title_candidates"] = sorted(
            title_candidates, key=lambda c: c["score"], reverse=True
        )
        result["duration_candidates"] = sorted(
            duration_candidates, key=lambda c: c["score"], reverse=True
        )

    if thumb_source:
        print(f"log: thumbnail source={thumb_source}", file=sys.stderr)
    if title_source:
        print(f"log: title source={title_source}", file=sys.stderr)
    if duration_source:
        print(f"log: duration source={duration_source}", file=sys.stderr)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
