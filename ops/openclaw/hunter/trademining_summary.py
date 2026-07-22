#!/usr/bin/env python3
"""Build canonical BOL rows and company shipment summaries from Phase 0 CSVs."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Optional


ROLE_FIELDS = [
    ("consignee_name", "Consignee Name"),
    ("notify_party", "Notify Name"),
    ("master_consignee_name", "Master Consignee Name"),
    ("shipper_name", "Shipper Name"),
    ("master_shipper_name", "Master Shipper Name"),
]


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

LEGAL_SUFFIX_PATTERN = re.compile(
    r"\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|"
    r"sa|s a|gmbh|ag|bv|usa|u s a|us|u s)\b",
    re.I,
)


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_company(value: str) -> str:
    text = clean(value).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[.,'\"]", " ", text)
    text = re.sub(r"[^a-z0-9\s-]", " ", text)
    text = LEGAL_SUFFIX_PATTERN.sub(" ", text)
    text = re.sub(r"\b(the|and)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_date(value: str) -> Optional[dt.date]:
    value = clean(value)
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return dt.datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return None


def number(value: str) -> float:
    try:
        return float(str(value or "").replace(",", ""))
    except ValueError:
        return 0.0


def key_hash(parts: list[str]) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]


def load_manifest(run_dir: Path) -> dict:
    manifest_path = run_dir / "manifest.json"
    if not manifest_path.exists():
        raise RuntimeError(f"missing manifest: {manifest_path}")
    return json.loads(manifest_path.read_text())


def iter_rows(run_dir: Path):
    manifest = load_manifest(run_dir)
    for port in manifest["ports"]:
        csv_path = Path(port["csv"])
        if not csv_path.is_absolute():
            csv_path = Path.cwd() / csv_path
        if not csv_path.exists():
            continue
        with csv_path.open(newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                yield port, row


def iter_run_dirs(raw_root: Path, start_date: dt.date, end_date: dt.date) -> list[Path]:
    run_dirs: list[Path] = []
    for manifest_path in sorted(raw_root.glob("*/manifest.json")):
        try:
            manifest = json.loads(manifest_path.read_text())
            run_start = dt.date.fromisoformat(manifest["start_date"])
            run_end = dt.date.fromisoformat(manifest["end_date"])
        except (KeyError, ValueError, json.JSONDecodeError):
            continue
        if run_end < start_date or run_start > end_date:
            continue
        run_dirs.append(manifest_path.parent)
    return run_dirs


def canonical_row(port: dict, row: dict) -> dict:
    arrival_date = clean(row.get("Arrival Date"))
    raw_key = key_hash(
        [
            arrival_date,
            clean(row.get("House BOL Number")),
            clean(row.get("Master BOL Number")),
            clean(row.get("Container Number")),
            clean(row.get("Consignee Name")),
            clean(row.get("Shipper Name")),
            clean(row.get("Container Content")),
        ]
    )
    return {
        "raw_record_key": raw_key,
        "source_system": "trade_mining",
        "source_report_name": f"phase0_{port['port_key']}",
        "source_saved_search_id": port.get("search_log_id", ""),
        "source_port": port["port_name"],
        "source_file_name": Path(port["csv"]).name,
        "source_file_date": arrival_date,
        "ingested_at": utc_now(),
        "arrival_date": arrival_date,
        "house_bol_number": clean(row.get("House BOL Number")),
        "master_bol_number": clean(row.get("Master BOL Number")),
        "container_number": clean(row.get("Container Number")),
        "bill_type": clean(row.get("Bill Type")),
        "importer_name": clean(row.get("Consignee Name")),
        "consignee_name": clean(row.get("Consignee Name")),
        "master_consignee_name": clean(row.get("Master Consignee Name")),
        "notify_party": clean(row.get("Notify Name")),
        "shipper_name": clean(row.get("Shipper Name")),
        "master_shipper_name": clean(row.get("Master Shipper Name")),
        "arrival_port": clean(row.get("US Arrival Port")) or port["port_name"],
        "foreign_port": clean(row.get("Foreign Port")),
        "place_of_receipt": clean(row.get("Place Of Receipt")),
        "destination_city": clean(row.get("Consignee City")) or clean(row.get("Notify City")),
        "destination_state": clean(row.get("Consignee State")) or clean(row.get("Notify State")),
        "destination_zip": clean(row.get("Consignee Zip")) or clean(row.get("Notify Zip")),
        "origin_country": clean(row.get("Country Of Origin")),
        "product_description": clean(row.get("Container Content")),
        "hs_code": clean(row.get("HS Code")),
        "container_count": clean(row.get("Container Count")),
        "teu": clean(row.get("TEU")),
        "weight": clean(row.get("Weight(KG)")),
        "quantity": clean(row.get("Quantity")),
        "carrier": clean(row.get("Carrier Name")),
        "vessel": clean(row.get("Vessel Name")),
        "voyage": clean(row.get("Voyage")),
        "raw_json": json.dumps(row, separators=(",", ":")),
}


def filter_rows_by_date(raw_rows: list[dict], start_date: dt.date, end_date: dt.date) -> list[dict]:
    filtered = []
    for row in raw_rows:
        arrival_date = parse_date(row.get("arrival_date", ""))
        if arrival_date is None:
            continue
        if start_date <= arrival_date <= end_date:
            filtered.append(row)
    return filtered


def dedupe_raw_rows(raw_rows: list[dict]) -> tuple[list[dict], int]:
    rows_by_key: dict[str, dict] = {}
    for row in raw_rows:
        key = row["raw_record_key"]
        # Overlapping trailing-seven-day pulls intentionally re-export prior BOLs.
        # Keep one canonical copy for scoring so recurring pulls do not inflate volume.
        rows_by_key.setdefault(key, row)
    return list(rows_by_key.values()), len(raw_rows) - len(rows_by_key)


def build_summary(raw_rows: list[dict], as_of: dt.date) -> list[dict]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in raw_rows:
        for role, field in ROLE_FIELDS:
            company = clean(row.get(role))
            match_name = normalize_company(company)
            if len(match_name) < 3:
                continue
            summary_key = "|".join(
                [
                    match_name,
                    role,
                    clean(row.get("arrival_port")).lower(),
                    clean(row.get("destination_state")).lower(),
                ]
            )
            enriched = dict(row)
            enriched["_company"] = company
            enriched["_match_name"] = match_name
            enriched["_role"] = role
            enriched["_summary_key"] = summary_key
            buckets[summary_key].append(enriched)

    summaries: list[dict] = []
    for summary_key, rows in buckets.items():
        dates = [parse_date(r["arrival_date"]) for r in rows]
        dates = [d for d in dates if d is not None]
        if not dates:
            continue
        current_30_start = as_of - dt.timedelta(days=29)
        prev_30_start = as_of - dt.timedelta(days=59)
        current_7_start = as_of - dt.timedelta(days=6)
        current_90_start = as_of - dt.timedelta(days=89)

        def in_range(row: dict, start: dt.date, end: dt.date) -> bool:
            d = parse_date(row["arrival_date"])
            return d is not None and start <= d <= end

        current_30 = [r for r in rows if in_range(r, current_30_start, as_of)]
        prev_30 = [r for r in rows if in_range(r, prev_30_start, current_30_start - dt.timedelta(days=1))]
        current_7 = [r for r in rows if in_range(r, current_7_start, as_of)]
        current_90 = [r for r in rows if in_range(r, current_90_start, as_of)]

        shipment_30 = len(current_30)
        shipment_prev_30 = len(prev_30)
        teu_30 = sum(number(r["teu"]) for r in current_30)
        teu_prev_30 = sum(number(r["teu"]) for r in prev_30)
        trend_score = score_trend(shipment_30, shipment_prev_30, teu_30, teu_prev_30, min(dates), as_of)
        latest = max(rows, key=lambda r: parse_date(r["arrival_date"]) or dt.date.min)
        fit_score = score_fit(latest["_role"], latest["destination_state"], latest["destination_city"])
        overall_score = trend_score + fit_score
        arrival_ports = join_recent(rows, "arrival_port")
        foreign_ports = join_recent(rows, "foreign_port")
        places_of_receipt = join_recent(rows, "place_of_receipt")
        destination_cities = join_recent(rows, "destination_city")
        destination_states = join_recent(rows, "destination_state")
        origin_countries = join_recent(rows, "origin_country")

        summaries.append(
            {
                "company_identity_key": latest["_match_name"],
                "company_summary_key": summary_key,
                "company_match_name": latest["_match_name"],
                "source_role": latest["_role"],
                "latest_company_name": latest["_company"],
                "arrival_port": latest["arrival_port"],
                "arrival_ports_seen": arrival_ports,
                "foreign_ports_seen": foreign_ports,
                "places_of_receipt_seen": places_of_receipt,
                "origin_countries_seen": origin_countries,
                "destination_state": latest["destination_state"],
                "destination_city_latest": latest["destination_city"],
                "destination_cities_seen": destination_cities,
                "destination_states_seen": destination_states,
                "first_seen_date": min(dates).isoformat(),
                "last_seen_date": max(dates).isoformat(),
                "seen_count": len(rows),
                "shipment_count_7d": len(current_7),
                "shipment_count_30d": shipment_30,
                "shipment_count_prev_30d": shipment_prev_30,
                "shipment_count_90d": len(current_90),
                "teu_30d": round(teu_30, 2),
                "teu_prev_30d": round(teu_prev_30, 2),
                "weight_30d": round(sum(number(r["weight"]) for r in current_30), 2),
                "weight_prev_30d": round(sum(number(r["weight"]) for r in prev_30), 2),
                "mom_shipment_growth_pct": growth_pct(shipment_30, shipment_prev_30),
                "mom_teu_growth_pct": growth_pct(teu_30, teu_prev_30),
                "latest_products": join_recent(rows, "product_description"),
                "latest_hs_codes": join_recent(rows, "hs_code"),
                "latest_origin_countries": origin_countries,
                "raw_evidence_count": len({r["raw_record_key"] for r in rows}),
                "trend_score": trend_score,
                "fit_score": fit_score,
                "overall_priority_score": overall_score,
                "score_reason": (
                    f"{shipment_30} shipments current 30d vs {shipment_prev_30} previous 30d; "
                    f"role={latest['_role']}; destination={latest['destination_city']}, {latest['destination_state']}"
                ),
                "apollo_status": "",
                "apollo_last_checked_at": "",
                "apollo_next_check_at": "",
                "apollo_organization_id": "",
                "apollo_domain": "",
                "apollo_contact_count": "",
                "updated_at": utc_now(),
            }
        )
    summaries.sort(key=lambda r: (number(r["overall_priority_score"]), number(r["shipment_count_30d"])), reverse=True)
    return summaries


def build_identity_summary(summary_rows: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in summary_rows:
        buckets[row["company_identity_key"]].append(row)

    identities: list[dict] = []
    for identity_key, rows in buckets.items():
        rows = sorted(rows, key=lambda r: (number(r["overall_priority_score"]), number(r["shipment_count_30d"])), reverse=True)
        best = rows[0]
        roles = sorted({r["source_role"] for r in rows if r.get("source_role")})
        ports = sorted({r["arrival_port"] for r in rows if r.get("arrival_port")})
        foreign_ports = sorted_unique_from_joined(rows, "foreign_ports_seen")
        places_of_receipt = sorted_unique_from_joined(rows, "places_of_receipt_seen")
        origin_countries = sorted_unique_from_joined(rows, "origin_countries_seen")
        cities = sorted_unique_from_joined(rows, "destination_cities_seen")
        states = sorted({r["destination_state"] for r in rows if r.get("destination_state")})
        identities.append(
            {
                "company_identity_key": identity_key,
                "company_match_name": best["company_match_name"],
                "best_company_name": best["latest_company_name"],
                "best_company_summary_key": best["company_summary_key"],
                "best_source_role": best["source_role"],
                "best_arrival_port": best["arrival_port"],
                "best_destination_state": best["destination_state"],
                "best_destination_city": best["destination_city_latest"],
                "first_seen_date": min(r["first_seen_date"] for r in rows if r.get("first_seen_date")),
                "last_seen_date": max(r["last_seen_date"] for r in rows if r.get("last_seen_date")),
                "role_count": len(roles),
                "roles_seen": "; ".join(roles),
                "ports_seen": "; ".join(ports),
                "arrival_ports_seen": "; ".join(ports),
                "foreign_ports_seen": "; ".join(foreign_ports),
                "places_of_receipt_seen": "; ".join(places_of_receipt),
                "origin_countries_seen": "; ".join(origin_countries),
                "destination_cities_seen": "; ".join(cities),
                "destination_states_seen": "; ".join(states),
                "summary_row_count": len(rows),
                "shipment_count_7d": sum(int(number(r["shipment_count_7d"])) for r in rows),
                "shipment_count_30d": sum(int(number(r["shipment_count_30d"])) for r in rows),
                "shipment_count_prev_30d": sum(int(number(r["shipment_count_prev_30d"])) for r in rows),
                "shipment_count_90d": sum(int(number(r["shipment_count_90d"])) for r in rows),
                "teu_30d": round(sum(number(r["teu_30d"]) for r in rows), 2),
                "teu_prev_30d": round(sum(number(r["teu_prev_30d"]) for r in rows), 2),
                "mom_shipment_growth_pct": growth_pct(
                    sum(number(r["shipment_count_30d"]) for r in rows),
                    sum(number(r["shipment_count_prev_30d"]) for r in rows),
                ),
                "mom_teu_growth_pct": growth_pct(
                    sum(number(r["teu_30d"]) for r in rows),
                    sum(number(r["teu_prev_30d"]) for r in rows),
                ),
                "best_trend_score": best["trend_score"],
                "best_fit_score": best["fit_score"],
                "overall_priority_score": best["overall_priority_score"],
                "score_reason": best["score_reason"],
                "apollo_status": "",
                "apollo_last_checked_at": "",
                "apollo_next_check_at": "",
                "apollo_organization_id": "",
                "apollo_domain": "",
                "apollo_contact_count": "",
                "updated_at": utc_now(),
            }
        )
    identities.sort(key=lambda r: (number(r["overall_priority_score"]), number(r["shipment_count_30d"])), reverse=True)
    return identities


def growth_pct(current: float, previous: float) -> str:
    if previous == 0:
        return "" if current == 0 else "new"
    return str(round(((current - previous) / previous) * 100, 2))


def score_trend(current: int, previous: int, teu_current: float, teu_previous: float, first_seen: dt.date, as_of: dt.date) -> int:
    score = 0
    if previous > 0 and current >= previous * 2 and current >= 3:
        score = 40
    elif previous > 0 and current >= previous * 1.5 and current >= 3:
        score = 25
    elif current > previous:
        score = 10
    elif current > 0 and first_seen >= as_of - dt.timedelta(days=30):
        score = 5
    if teu_current > teu_previous and teu_current > 0:
        score += 5
    return score


def score_fit(role: str, destination_state: str, destination_city: str) -> int:
    role_scores = {
        "consignee_name": 20,
        "notify_party": 18,
        "master_consignee_name": 14,
        "shipper_name": 5,
        "master_shipper_name": 3,
    }
    score = role_scores.get(role, 0)
    state = clean(destination_state).lower()
    city = clean(destination_city).lower()
    if state in {"north carolina", "south carolina", "georgia", "tennessee", "virginia"}:
        score += 10
    if city in {"charlotte", "concord", "gastonia", "huntersville", "rock hill", "fort mill"}:
        score += 10
    return score


def join_recent(rows: list[dict], field: str, limit: int = 5) -> str:
    values = []
    seen = set()
    for row in sorted(rows, key=lambda r: parse_date(r["arrival_date"]) or dt.date.min, reverse=True):
        value = clean(row.get(field))
        key = value.lower()
        if value and key not in seen:
            values.append(value)
            seen.add(key)
        if len(values) >= limit:
            break
    return "; ".join(values)


def sorted_unique_from_joined(rows: list[dict], field: str) -> list[str]:
    values = set()
    for row in rows:
        for value in clean(row.get(field)).split(";"):
            value = clean(value)
            if value:
                values.add(value)
    return sorted(values, key=str.lower)


def write_rows(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("")
        return
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--run-dir")
    source.add_argument("--raw-root")
    parser.add_argument("--as-of", default="")
    parser.add_argument("--lookback-days", type=int, default=90)
    parser.add_argument("--output-root", default="data/trademining/processed")
    args = parser.parse_args()

    raw_rows: list[dict] = []
    source_run_dirs: list[Path] = []
    if args.run_dir:
        run_dir = Path(args.run_dir)
        manifest = load_manifest(run_dir)
        as_of = dt.date.fromisoformat(args.as_of or manifest["end_date"])
        source_run_dirs = [run_dir]
        raw_rows = [canonical_row(port, row) for port, row in iter_rows(run_dir)]
    else:
        as_of = dt.date.fromisoformat(args.as_of or dt.date.today().isoformat())
        start_date = as_of - dt.timedelta(days=args.lookback_days - 1)
        source_run_dirs = iter_run_dirs(Path(args.raw_root), start_date, as_of)
        for run_dir in source_run_dirs:
            raw_rows.extend(canonical_row(port, row) for port, row in iter_rows(run_dir))
        raw_rows = filter_rows_by_date(raw_rows, start_date, as_of)

    output_dir = Path(args.output_root) / as_of.isoformat()

    raw_rows_before_dedupe = len(raw_rows)
    raw_rows, duplicate_raw_rows_removed = dedupe_raw_rows(raw_rows)
    summary_rows = build_summary(raw_rows, as_of)
    identity_rows = build_identity_summary(summary_rows)

    raw_path = output_dir / "trade_mining_raw_bol_canonical.csv"
    summary_path = output_dir / "company_shipment_summary.csv"
    identity_path = output_dir / "company_identity_summary.csv"
    write_rows(raw_path, raw_rows)
    write_rows(summary_path, summary_rows)
    write_rows(identity_path, identity_rows)

    result = {
        "as_of": as_of.isoformat(),
        "lookback_days": args.lookback_days if args.raw_root else "",
        "source_run_dirs": [str(path) for path in source_run_dirs],
        "raw_rows_before_dedupe": raw_rows_before_dedupe,
        "duplicate_raw_rows_removed": duplicate_raw_rows_removed,
        "raw_rows": len(raw_rows),
        "summary_rows": len(summary_rows),
        "identity_rows": len(identity_rows),
        "raw_path": str(raw_path),
        "summary_path": str(summary_path),
        "identity_path": str(identity_path),
    }
    (output_dir / "manifest.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
