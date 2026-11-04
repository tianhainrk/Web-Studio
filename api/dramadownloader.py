"""Optional DramaDownloader Python extractor bridge for the authenticated Studio.

Runs per request. It does not accept arbitrary URLs, download media on the
server, manage Google credentials, or change a provider's access permissions.
"""
import json
import os
import hmac
import hashlib
import re
from http.server import BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from urllib.parse import urlparse

VALID_HOSTS = {"www.dramaboxdb.com", "dramaboxdb.com"}
MAX_BYTES = 2048

def allowed_target(raw):
    value = str(raw or "").strip()
    if re.fullmatch(r"[1-9][0-9]{4,18}", value):
        return "https://www.dramaboxdb.com/movie/" + value + "/drama"
    parsed = urlparse(value)
    if (parsed.scheme != "https" or parsed.hostname not in VALID_HOSTS or
            parsed.username or parsed.password or parsed.port or parsed.fragment or
            not re.fullmatch(r"/movie/[1-9][0-9]{4,18}/drama/?", parsed.path)):
        raise ValueError("Chỉ chấp nhận Book ID hoặc link phim DramaBox HTTPS hợp lệ")
    return "https://www.dramaboxdb.com" + parsed.path.rstrip("/")

def authenticated(cookie_header):
    secret = os.getenv("SESSION_SECRET", "")
    if len(secret) < 32:
        return False
    try:
        from time import time
        cookie = SimpleCookie()
        cookie.load(cookie_header or "")
        raw = cookie.get("pws")
        if not raw:
            return False
        expiry, signature = raw.value.split(".", 1)
        if not re.fullmatch(r"[0-9]{13}", expiry) or not re.fullmatch(r"[a-f0-9]{64}", signature):
            return False
        now = int(time() * 1000)
        if int(expiry) <= now or int(expiry) > now + 86400000:
            return False
        expected = hmac.new(secret.encode(), expiry.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected)
    except Exception:
        return False

def sanitized_url(raw):
    value = str(raw or "").strip()
    try:
        parsed = urlparse(value)
        if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password and not parsed.port:
            return value[:4096]
    except Exception:
        pass
    return None

class handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        if not authenticated(self.headers.get("Cookie")):
            return self.reply(401, {"error":"Cần đăng nhập PineDrama Studio"})
        length = self.headers.get("Content-Length", "")
        if not length.isdigit() or int(length) > MAX_BYTES:
            return self.reply(413, {"error":"Request không hợp lệ hoặc vượt 2 KiB"})
        try:
            data = json.loads(self.rfile.read(int(length)))
            target = allowed_target(data.get("target"))
        except (ValueError, json.JSONDecodeError, TypeError) as exc:
            return self.reply(400, {"error":str(exc)})
        try:
            from drama_downloader import load_series
            series = load_series(target, platform_hint="dramabox")
            episodes = []
            for ep in series.episodes[:5000]:
                index = int(ep.num)
                if not (1 <= index <= 5000):
                    continue
                # Direct URL is a technical locator, not proof of playback entitlement.
                url = sanitized_url(ep.direct_url) if not ep.locked else None
                episodes.append({
                    "num":index, "title":str(ep.title or ("Tập " + str(index)))[:140],
                    "locked":bool(ep.locked), "direct_url":url,
                    "source_status":"python_provider_url" if url else "python_provider_no_url",
                })
            return self.reply(200, {
                "ok":True,
                "provider":"K07VN/DramaDownloader (Python)",
                "series":{
                    "platform":"dramabox",
                    "series_id":str(series.series_id),
                    "name":str(series.name)[:140],
                    "episode_count":len(episodes),
                    "reported_episode_count":int(series.episode_count),
                    "episodes":episodes,
                    "source":"Python extractor: provider URL availability is not proof of free or licensed access"
                },
                "note":"Một số URL phát có thể hết hạn, bị chặn CORS hoặc yêu cầu quyền truy cập."
            })
        except ImportError:
            return self.reply(503, {"error":"Chưa cài được DramaDownloader Python dependency trên Vercel"})
        except Exception as exc:
            return self.reply(502, {"error":"DramaDownloader không lấy được dữ liệu: "+str(exc)[:180]})

    def do_GET(self):
        return self.reply(405, {"error":"Sử dụng POST"})
