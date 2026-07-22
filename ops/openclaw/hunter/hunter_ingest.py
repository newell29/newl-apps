#!/usr/bin/env python3
"""Post Hunter's canonical TradeMining CSV rows to tenant-bound Newl Apps APIs."""

from __future__ import annotations

import argparse
import csv
import json
import os
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable, Optional


COMPANY_IDENTITY_FIELDS = (
    "importerName",
    "consigneeName",
    "masterConsigneeName",
    "notifyParty",
    "shipperName",
    "masterShipperName",
)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def api_headers(token: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Newl-Hunter-Ingestion/1.0",
    }
    bypass_secret = os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET", "").strip()
    if bypass_secret:
        headers["x-vercel-protection-bypass"] = bypass_secret
    return headers


def api_request(base_url: str, token: str, method: str, path: str, payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        method=method,
        headers=api_headers(token),
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            response_body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        response_body = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"Newl Apps request failed with HTTP {error.code}: {safe_error_message(response_body)}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Newl Apps request failed: {error.reason}") from error

    try:
        parsed = json.loads(response_body) if response_body else {}
    except json.JSONDecodeError as error:
        raise RuntimeError("Newl Apps returned a non-JSON response") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("Newl Apps returned an unexpected response shape")
    return parsed


def safe_error_message(value: str) -> str:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return "response body omitted"
    if not isinstance(parsed, dict):
        return "response body omitted"
    error = parsed.get("error")
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return error["message"][:500]
    if isinstance(error, str):
        details = parsed.get("details")
        safe_details = []
        if isinstance(details, list):
            for detail in details[:3]:
                if isinstance(detail, str) and "\n" not in detail:
                    safe_details.append(detail[:200])
        suffix = f" {'; '.join(safe_details)}" if safe_details else ""
        return f"{error[:250]}{suffix}"[:500]
    return "response body omitted"


def read_canonical_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def clean(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def number(value: Any) -> Optional[float]:
    text = clean(value)
    if text is None:
        return None
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def record_payload(row: dict[str, str], destination_market: Optional[str]) -> dict[str, Any]:
    raw_row: dict[str, Any]
    try:
        parsed = json.loads(row.get("raw_json", "{}"))
        raw_row = parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        raw_row = {}

    return {
        "importerName": clean(row.get("importer_name")),
        "consigneeName": clean(row.get("consignee_name")),
        "masterConsigneeName": clean(row.get("master_consignee_name")),
        "notifyParty": clean(row.get("notify_party")),
        "shipperName": clean(row.get("shipper_name")),
        "masterShipperName": clean(row.get("master_shipper_name")),
        "bolNumber": clean(row.get("house_bol_number")) or clean(row.get("master_bol_number")),
        "houseBolNumber": clean(row.get("house_bol_number")),
        "masterBolNumber": clean(row.get("master_bol_number")),
        "containerNumber": clean(row.get("container_number")),
        "billType": clean(row.get("bill_type")),
        "shipmentDate": clean(row.get("arrival_date")),
        "originCountry": clean(row.get("origin_country")),
        "originPort": clean(row.get("foreign_port")),
        "foreignPort": clean(row.get("foreign_port")),
        "shipFromPort": clean(row.get("place_of_receipt")),
        "placeOfReceipt": clean(row.get("place_of_receipt")),
        "arrivalPort": clean(row.get("arrival_port")),
        "destinationPort": clean(row.get("arrival_port")),
        "destinationMarket": destination_market,
        "destinationCity": clean(row.get("destination_city")),
        "destinationState": clean(row.get("destination_state")),
        "destinationZip": clean(row.get("destination_zip")),
        "productDescription": clean(row.get("product_description")),
        "hsCode": clean(row.get("hs_code")),
        "containerCount": number(row.get("container_count")),
        "teu": number(row.get("teu")),
        "weight": number(row.get("weight")),
        "quantity": number(row.get("quantity")),
        "carrier": clean(row.get("carrier")),
        "vessel": clean(row.get("vessel")),
        "voyage": clean(row.get("voyage")),
        "rawData": {
            "hunterCanonicalRecord": {key: value for key, value in row.items() if key != "raw_json"},
            "tradeMiningRow": raw_row,
        },
    }


def has_company_identity(record: dict[str, Any]) -> bool:
    return any(clean(record.get(field)) for field in COMPANY_IDENTITY_FIELDS)


def prepare_records(rows: list[dict[str, str]], destination_market: Optional[str]) -> tuple[list[dict[str, Any]], int]:
    records = [record_payload(row, destination_market) for row in rows]
    valid_records = [record for record in records if has_company_identity(record)]
    return valid_records, len(records) - len(valid_records)


def chunks(values: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--profile-name", default="")
    parser.add_argument("--job-run-id", default="", help="Use a job run created by the coordinating worker.")
    parser.add_argument("--canonical-csv", required=True)
    parser.add_argument("--destination-market", default="")
    parser.add_argument("--batch-size", type=int, default=250)
    args = parser.parse_args()

    if args.batch_size < 1 or args.batch_size > 500:
        raise RuntimeError("--batch-size must be between 1 and 500")

    base_url = required_env("NEWL_APPS_BASE_URL")
    token = required_env("INGESTION_API_TOKEN")
    csv_path = Path(args.canonical_csv).expanduser().resolve()
    rows = read_canonical_rows(csv_path)
    records, rejected_before_upload = prepare_records(rows, clean(args.destination_market))

    job_run_id = clean(args.job_run_id)
    if not job_run_id:
        job_response = api_request(
            base_url,
            token,
            "POST",
            "/api/integrations/trademining/job-runs",
            {
                "source": "OPENCLAW",
                "searchProfileId": args.profile_id,
                "metadata": {
                    "workerId": os.environ.get("HUNTER_WORKER_ID", socket.gethostname()),
                    "agent": "Hunter",
                    "profileName": clean(args.profile_name),
                    "sourceFile": csv_path.name,
                    "sourceRecords": len(rows),
                    "recordsRejectedBeforeUpload": rejected_before_upload,
                },
            },
        )
        data = job_response.get("data") if isinstance(job_response.get("data"), dict) else {}
        job_run_id = clean(data.get("jobRunId"))
        if not job_run_id:
            raise RuntimeError("Newl Apps did not return a job run ID")

    processed = created = updated = skipped = 0
    try:
        for batch in chunks(records, args.batch_size):
            batch_response = api_request(
                base_url,
                token,
                "POST",
                "/api/integrations/trademining/batches",
                {
                    "jobRunId": job_run_id,
                    "searchProfileId": args.profile_id,
                    "source": "OPENCLAW",
                    "records": batch,
                },
            )
            data = batch_response.get("data") if isinstance(batch_response.get("data"), dict) else {}
            processed += int(data.get("recordsProcessed") or len(batch))
            created += int(data.get("recordsCreated") or 0)
            updated += int(data.get("recordsUpdated") or 0)
            skipped += int(data.get("recordsSkipped") or 0)

        api_request(
            base_url,
            token,
            "PATCH",
            f"/api/integrations/trademining/job-runs/{job_run_id}",
            {
                "status": "COMPLETED",
                "recordsProcessed": processed,
                "recordsCreated": created,
                "recordsUpdated": updated,
                "metadata": {
                    "agent": "Hunter",
                    "recordsSkipped": skipped,
                    "recordsRejectedBeforeUpload": rejected_before_upload,
                },
            },
        )
    except Exception as error:
        try:
            api_request(
                base_url,
                token,
                "PATCH",
                f"/api/integrations/trademining/job-runs/{job_run_id}",
                {
                    "status": "FAILED",
                    "errorMessage": str(error)[:500],
                    "metadata": {"agent": "Hunter", "recordsProcessedBeforeFailure": processed},
                },
            )
        except Exception:
            pass
        raise

    print(json.dumps({
        "jobRunId": job_run_id,
        "recordsProcessed": processed,
        "recordsCreated": created,
        "recordsUpdated": updated,
        "recordsSkipped": skipped + rejected_before_upload,
        "recordsRejectedBeforeUpload": rejected_before_upload,
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Hunter ingestion failed: {error}", file=sys.stderr)
        raise SystemExit(1)
