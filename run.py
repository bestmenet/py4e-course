#!/usr/bin/env python3
"""Start the offline Python for Everybody course.

    python3 run.py                # http://127.0.0.1:8000
    python3 run.py --open         # ...and open a browser window
    python3 run.py --port 9000

Standard library only — no pip install, no virtualenv.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "server"))

from app import serve  # noqa: E402

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Serve the offline PY4E course")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PY4E_PORT", 8000)),
                        help="port to listen on (default 8000, bumped if taken)")
    parser.add_argument("--host", default=os.environ.get("PY4E_HOST", "127.0.0.1"),
                        help="interface to bind (default 127.0.0.1)")
    parser.add_argument("--open", action="store_true", help="open a browser window")
    args = parser.parse_args()
    serve(args.host, args.port, args.open)
