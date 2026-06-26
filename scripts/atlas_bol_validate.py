#!/usr/bin/env python3
"""
Atlas BOL trial — ImportYeti density / lane validation via Apify.

Fires the row-level ImportYeti actor against two ICP candidates
(Helios Technologies vs Standex International) and reports, per company:
    - total BOL rows returned
    - distinct FOREIGN suppliers (the supplier-layer points on the map)
    - distinct US destination ports (how spread-out the map looks)
    - the lane origins (supplier countries) seen

Pick heuristic (from the Atlas Trial Data Sourcing doc): highest
distinct-suppliers + distinct-ports per dollar wins.

The token is read from the environment — it is never stored in this file.

    export APIFY_TOKEN=apify_api_xxxxxxxx
    python3 atlas_bol_validate.py

Optional overrides:
    ACTOR=parseforge/importyeti-scraper python3 atlas_bol_validate.py
    MIN_SHIPMENTS=5 python3 atlas_bol_validate.py     # drop ghost records
    MAX_ITEMS=2000 python3 atlas_bol_validate.py      # raise the 50-row cap (0 = no cap)
"""
import os
import sys
import json
import ssl
import urllib.parse
import urllib.request

# TLS context with a real CA bundle. Some Python builds (notably the python.org
# macOS installer) ship without a populated default cert store, which yields
# "CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate". Prefer
# certifi's bundle when present; fall back to the system default otherwise.
# Verification stays ON either way.
try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl.create_default_context()

# Row-level actor (returns per-BOL rows: supplier, country, carrier, port, HS, weight).
# Swap via ACTOR=... if you prefer another variant; field extraction below is defensive.
ACTOR = os.environ.get("ACTOR", "jungle_synthesizer/importyeti-bill-of-lading-scraper")
TOKEN = os.environ.get("APIFY_TOKEN")
MIN_SHIPMENTS = int(os.environ.get("MIN_SHIPMENTS", "0"))  # 0 = off
# Actor caps output at maxItems (schema default 50). 0 = no cap. Each row is a
# billed event on this pay-per-result actor, so raise deliberately.
MAX_ITEMS = int(os.environ.get("MAX_ITEMS", "1000"))
DEBUG = bool(os.environ.get("DEBUG"))  # DEBUG=1 dumps the raw actor row shape

CANDIDATES = {
    "Helios Technologies": [
        "sun-hydraulics",
        "faster",
        "enovation-controls",
        "balboa-water-group",
        "daman-products",
    ],
    "Standex International": [
        "standex-electronics",
        "standex-meder-electronics",
        "renco-electronics",
        "bakers-pride",
        "nor-lake",
        "standex",
    ],
}

# Real fields from jungle_synthesizer/importyeti-bill-of-lading-scraper. The
# foreign supplier is the "counterparty"; older generic aliases are kept as
# fallbacks so swapping ACTOR= to another variant still works.
SUPPLIER_KEYS = ["counterparty_name", "supplier", "supplier_name", "shipper",
                 "shipper_name", "supplierName", "shipperName"]
COUNTRY_KEYS = ["counterparty_country", "supplier_country", "shipper_country",
                "origin_country", "country", "supplierCountry"]
# This actor exposes no port; the US side is the importer entity (target_*),
# which is exactly what Atlas geocodes as the destination point.
DEST_KEYS = ["target_slug", "target_name", "destination_port", "port_of_unlading",
             "us_port", "arrival_port", "port"]
TYPE_KEYS = ["record_type", "recordType", "type"]

US_ALIASES = {"US", "USA", "UNITED STATES", "U.S.", "U.S.A."}


def first(row, keys):
    for k in keys:
        v = row.get(k)
        if v not in (None, "", "null", "Missing in source document"):
            return v
    return None


def run_actor(slugs):
    actor_path = ACTOR.replace("/", "~")
    url = (f"https://api.apify.com/v2/acts/{actor_path}"
           f"/run-sync-get-dataset-items?token={urllib.parse.quote(TOKEN)}")
    payload = {"companies": slugs, "suppliers": [], "maxItems": MAX_ITEMS}
    if MIN_SHIPMENTS > 0:
        payload["minShipments"] = MIN_SHIPMENTS
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600, context=_SSL_CTX) as resp:
        return json.loads(resp.read().decode())


def debug_dump(label, rows):
    """Print the actor's real row shape so the *_KEYS lists can be aligned."""
    from collections import Counter
    dicts = [r for r in rows if isinstance(r, dict)]
    shapes = Counter(tuple(sorted(r.keys())) for r in dicts)
    print(f"\n[DEBUG] {label}: {len(rows)} rows, {len(shapes)} distinct shape(s)",
          file=sys.stderr)
    for keys, cnt in shapes.most_common(3):
        print(f"[DEBUG]   shape x{cnt}: {list(keys)}", file=sys.stderr)
    # Prefer a non-summary (per-shipment) row — the summary rollup has blank
    # counterparty fields and tells us nothing about the per-row mapping.
    sample = next(
        (r for r in dicts
         if "summary" not in (first(r, TYPE_KEYS) or "").lower()),
        dicts[0] if dicts else None,
    )
    if sample:
        print("[DEBUG]   sample (non-summary) row:", file=sys.stderr)
        print(json.dumps(sample, indent=2, ensure_ascii=False)[:1800],
              file=sys.stderr)


def metrics(rows):
    suppliers, dests, countries = set(), set(), {}
    bol_rows = 0
    for r in rows:
        if not isinstance(r, dict):
            continue
        rtype = (first(r, TYPE_KEYS) or "").lower()
        if "summary" in rtype:          # skip aggregate rollup rows
            continue
        bol_rows += 1
        sup = first(r, SUPPLIER_KEYS)
        ctry = (first(r, COUNTRY_KEYS) or "").strip().upper()
        if sup and ctry not in US_ALIASES:
            suppliers.add(str(sup).strip().lower())
            if ctry:
                countries[ctry] = countries.get(ctry, 0) + 1
        dest = first(r, DEST_KEYS)      # US importer entity (Atlas destination)
        if dest:
            dests.add(str(dest).strip().lower())
    return {
        "bol_rows": bol_rows,
        "suppliers": len(suppliers),
        "dests": len(dests),
        "lanes": sorted(countries.items(), key=lambda x: -x[1]),
    }


def main():
    if not TOKEN:
        sys.exit("Set APIFY_TOKEN first:  export APIFY_TOKEN=apify_api_xxxx")

    out = {}
    dumped = False
    for label, slugs in CANDIDATES.items():
        print(f"-> scraping {label}: {', '.join(slugs)}", file=sys.stderr)
        try:
            rows = run_actor(slugs)
        except Exception as e:
            print(f"   !! run failed for {label}: {e}", file=sys.stderr)
            rows = []
        m = metrics(rows)
        # Auto-diagnose the field-mapping mismatch: if rows came back but none
        # parsed into suppliers, the actor's field names differ from *_KEYS.
        if rows and not dumped and (DEBUG or m["suppliers"] == 0):
            debug_dump(label, rows)
            dumped = True
        out[label] = m

    print("\n" + "=" * 64)
    print(f"{'Company':<24}{'BOL rows':>10}{'Suppliers':>11}{'US dests':>10}")
    print("-" * 64)
    for label, m in out.items():
        print(f"{label:<24}{m['bol_rows']:>10}{m['suppliers']:>11}{m['dests']:>10}")
    print("=" * 64)

    for label, m in out.items():
        top = ", ".join(f"{c}({n})" for c, n in m["lanes"][:8]) or "(none)"
        print(f"\n{label} — lane origins: {top}")

    # Verdict on the doc's heuristic: distinct suppliers + distinct ports.
    if all(out.values()):
        # dests is pinned at 1 by the actor's ~50-row sample cap, so rank on
        # distinct suppliers + distinct lane countries (the real Atlas richness).
        winner = max(out, key=lambda k: out[k]["suppliers"] + len(out[k]["lanes"]))
        print(f"\nRichest on (distinct suppliers + lane countries): {winner}")


if __name__ == "__main__":
    main()
