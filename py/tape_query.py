#!/usr/bin/env python
"""tape_query.py: the Tape panel's read-only reader over ~/vader-swarm/data/kalshi/lab/tape (core/tape outputs).

Run by the Electron main process with the vader-swarm venv; prints one JSON object on stdout.
    days [asset]                         -> {"days": [...], "strategies": [...]}
    windows <day> [asset]                -> {"windows": [{ticker, close_ts, outcome_yes, feed_ok}]}
    window <ticker> <day> <strategy>     -> per-second series + the hindsight strip for that strategy
    summary <day_from> <day_to> [asset]  -> share of entries net > 0 and mean c/ct by strategy x tau bucket
Never writes to the tape data. Per-day summaries are cached under $TAPE_CACHE (keyed by file mtime)."""
import json, math, os, sys
from pathlib import Path

ROOT = Path(os.path.expanduser("~/vader-swarm"))
TAPE = ROOT / "data" / "kalshi" / "lab" / "tape"
CACHE = Path(os.environ.get("TAPE_CACHE", "/tmp/mbcode_tape_cache"))
TAU_EDGES = [5, 60, 180, 300, 450, 600, 900]   # core/tape/run_v0.py


def out(obj):
    def clean(x):
        if isinstance(x, float):
            return None if (math.isnan(x) or math.isinf(x)) else round(x, 6)
        if isinstance(x, dict):
            return {k: clean(v) for k, v in x.items()}
        if isinstance(x, (list, tuple)):
            return [clean(v) for v in x]
        return x
    sys.stdout.write(json.dumps(clean(obj)))


def oracle_files(asset):
    return sorted((TAPE / "oracle" / asset).glob("*.parquet"))


def strategies_of(path):
    import pyarrow.parquet as pq
    return [c[5:] for c in pq.read_schema(path).names if c.startswith("net__")]


def cmd_days(asset="BTC"):
    fs = oracle_files(asset)
    out({"days": [f.stem for f in fs], "strategies": strategies_of(fs[0]) if fs else [], "asset": asset})


def cmd_windows(day, asset="BTC"):
    import pandas as pd
    o = pd.read_parquet(TAPE / "oracle" / asset / f"{day}.parquet", columns=["ticker", "close_ts", "side", "won", "feed_ok"])
    y = o[o.side == "yes"].groupby("ticker").agg(close_ts=("close_ts", "first"), outcome_yes=("won", "first"), feed_ok=("feed_ok", "min")).reset_index()
    y = y.sort_values("close_ts")
    out({"windows": [{"ticker": r.ticker, "close_ts": int(r.close_ts), "outcome_yes": float(r.outcome_yes), "feed_ok": bool(r.feed_ok)} for r in y.itertuples()]})


def cmd_window(ticker, day, strategy):
    import numpy as np, pandas as pd
    sys.path.insert(0, str(ROOT))
    from core.tape.data import window
    asset = "ETH" if "ETH" in ticker.upper() else "BTC"
    w = window(ticker, day=day, asset=asset)
    o = pd.read_parquet(TAPE / "oracle" / asset / f"{day}.parquet", columns=["ticker", "s", "side", f"net__{strategy}"], filters=[("ticker", "=", ticker)])
    col = f"net__{strategy}"
    strip = {}
    for side in ("yes", "no"):
        z = o[o.side == side].set_index("s")[col]
        strip[side] = [None if pd.isna(v) else float(v) * 100 for v in z.reindex(w.s).values]   # c/ct
    num = lambda c: [None if pd.isna(v) else float(v) for v in w[c].values] if c in w else []
    K = float(w.K.dropna().iloc[0]) if w.K.notna().any() else None
    oc = float(w.outcome_yes.dropna().iloc[0]) if w.outcome_yes.notna().any() else None
    pos = {s: (np.array([v for v in strip[s] if v is not None]) > 0).mean() if any(v is not None for v in strip[s]) else None for s in strip}
    out({"ticker": ticker, "day": day, "strategy": strategy, "K": K, "outcome_yes": oc, "close_ts": int(w.close_ts.iloc[0]),
         "feed_ok": bool(w.feed_ok.min()) if "feed_ok" in w else None,
         "s": [int(v) for v in w.s.values], "tau": [int(v) for v in w.tau.values],
         "yes_px": num("yes_px"), "no_px": num("no_px"), "mid": num("mid"), "bn": num("bn"), "idx": num("idx"),
         "strip": strip, "share_pos": pos})


def day_summary(path):
    import pandas as pd
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / f"sum_{path.parent.name}_{path.stem}_{int(path.stat().st_mtime)}.json"
    if key.exists():
        return json.loads(key.read_text())
    strats = strategies_of(path)
    o = pd.read_parquet(path, columns=["tau"] + [f"net__{s}" for s in strats])
    o["tb"] = pd.cut(o.tau, TAU_EDGES).astype(str)
    res = {}
    for s in strats + ["best"]:
        v = o[[f"net__{x}" for x in strats]].max(axis=1) if s == "best" else o[f"net__{s}"]
        g = pd.DataFrame({"tb": o.tb, "v": v}).dropna().groupby("tb").v
        res[s] = {tb: {"n": int(n), "pos": int(p), "sum": float(sm)} for tb, n, p, sm in zip(g.size().index, g.size().values, g.apply(lambda x: (x > 0).sum()).values, g.sum().values)}
    key.write_text(json.dumps(res))
    return res


def cmd_summary(d0, d1, asset="BTC"):
    fs = [f for f in oracle_files(asset) if d0 <= f.stem <= d1]
    agg = {}
    for f in fs:
        for s, byt in day_summary(f).items():
            for tb, r in byt.items():
                a = agg.setdefault(s, {}).setdefault(tb, {"n": 0, "pos": 0, "sum": 0.0})
                a["n"] += r["n"]; a["pos"] += r["pos"]; a["sum"] += r["sum"]
    buckets = [f"({a}, {b}]" for a, b in zip(TAU_EDGES[:-1], TAU_EDGES[1:])]
    rows = []
    for s, byt in agg.items():
        cells = {tb: ({"share": r["pos"] / r["n"], "cpct": 100 * r["sum"] / r["n"], "n": r["n"]} if r["n"] else None) for tb, r in byt.items()}
        rows.append({"strategy": s, "cells": cells})
    out({"days": [f.stem for f in fs], "buckets": buckets, "rows": rows})


if __name__ == "__main__":
    a = sys.argv[1:]
    try:
        {"days": cmd_days, "windows": cmd_windows, "window": cmd_window, "summary": cmd_summary}[a[0]](*a[1:])
    except Exception as e:
        out({"error": f"{type(e).__name__}: {e}"})
