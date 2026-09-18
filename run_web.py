#!/usr/bin/env python3
"""
AegisICU -- Web Server Runner
Serves the ICU Early Warning System dashboard on http://localhost:8000
and automatically opens the browser.

Usage:
    python run_web.py
    python run_web.py --port 9000
    python run_web.py --no-browser
"""

import http.server
import socketserver
import webbrowser
import threading
import argparse
import os
import sys
from pathlib import Path

# The web directory is where THIS script lives
WEB_DIR = str(Path(__file__).parent.resolve())
DEFAULT_PORT = 8000


def parse_args():
    parser = argparse.ArgumentParser(
        description="AegisICU -- ICU Early Warning System Web Server"
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=DEFAULT_PORT,
        help="Port to serve on (default: %d)" % DEFAULT_PORT
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't automatically open the browser"
    )
    return parser.parse_args()


class AegisHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP handler serving from WEB_DIR with no-cache headers."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        code = args[1] if len(args) > 1 else "?"
        path = args[0].split()[1] if args and " " in str(args[0]) else str(args[0])
        print("  [%s]  %s" % (code, path))


def open_browser_delayed(url, delay=0.9):
    def _open():
        import time
        time.sleep(delay)
        print("\n  [>] Opening browser -> %s\n" % url)
        webbrowser.open(url)
    t = threading.Thread(target=_open, daemon=True)
    t.start()


def main():
    args = parse_args()
    port = args.port

    # Verify files exist
    index_path = os.path.join(WEB_DIR, "index.html")
    if not os.path.isfile(index_path):
        print("[ERROR] index.html not found in: %s" % WEB_DIR)
        sys.exit(1)

    url = "http://localhost:%d" % port

    print()
    print("  +----------------------------------------------------------+")
    print("  |  AegisICU -- ICU Early Warning System  v2.0.26          |")
    print("  |  MIMIC-III Validated  |  XGBoost  |  AUROC 0.890        |")
    print("  +----------------------------------------------------------+")
    print("  |  URL:  %-50s|" % url)
    wd = WEB_DIR
    if len(wd) > 50:
        wd = "..." + wd[-47:]
    print("  |  Dir:  %-50s|" % wd)
    print("  |  Press Ctrl+C to stop the server                        |")
    print("  +----------------------------------------------------------+")
    print()

    if not args.no_browser:
        open_browser_delayed(url)

    try:
        # TCPServer with allow_reuse_address
        socketserver.TCPServer.allow_reuse_address = True
        with socketserver.TCPServer(("", port), AegisHandler) as httpd:
            print("  [OK] Server is running at %s" % url)
            print("  [OK] Serving directory: %s" % WEB_DIR)
            print("  [OK] 18 MIMIC-III patients | AUROC 0.8904 | Threshold 0.35")
            print()
            httpd.serve_forever()
    except OSError as e:
        if "10048" in str(e) or "Address already in use" in str(e):
            print("[WARN] Port %d is already in use. Try: python run_web.py --port %d" % (port, port + 1))
        else:
            print("[ERROR] %s" % e)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n  [OK] Server stopped.\n")


if __name__ == "__main__":
    main()
