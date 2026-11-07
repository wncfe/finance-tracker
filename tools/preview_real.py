"""Run the local UI against a disposable copy of the verified normalized snapshot."""
import argparse
from pathlib import Path
import sqlite3
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8002);args=parser.parse_args()
    source=ROOT/'data/normalized-real-final.sqlite3'
    target=ROOT/'data/preview-real.sqlite3'
    if not target.exists():
        original=sqlite3.connect(f'file:{source}?mode=ro',uri=True)
        preview=sqlite3.connect(target)
        original.backup(preview);preview.close();original.close()
    server.DB=target;server.init()
    print(f'Local preview: http://127.0.0.1:{args.port} (separate working copy, original backup unchanged)',flush=True)
    server.ThreadingHTTPServer(('127.0.0.1',args.port),server.Handler).serve_forever()
