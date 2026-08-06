#!/usr/bin/env python3
"""Post Hunter's canonical TradeMining CSV rows to tenant-bound Newl Apps APIs."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
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

CHECKPOINT_VERSION = 1
TRANSIENT_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504}
TRANSIENT_RETRY_DELAYS_SECONDS = (2, 5, 15)


class NewlAppsRequestError(RuntimeError):
    def __init__(self, message: str, *, status: Optional[int] = None, retry_after: Optional[int] = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after

    @property
    def transient(self) -> bool:
        return self.status is None or self.status in TRANSIENT_HTTP_STATUSES


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
        retry_after = parse_retry_after(error.headers.get("Retry-After"))
        raise NewlAppsRequestError(
            f"Newl Apps request failed with HTTP {error.code}: {safe_error_message(response_body)}",
            status=error.code,
            retry_after=retry_after,
        ) from error
    except urllib.error.URLError as error:
        raise NewlAppsRequestError(f"Newl Apps request failed: {error.reason}") from error

    try:
        parsed = json.loads(response_body) if response_body else {}
    except json.JSONDecodeError as error:
        raise RuntimeError("Newl Apps returned a non-JSON response") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("Newl Apps returned an unexpected response shape")
    return parsed


def parse_retry_after(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    try:
        return max(0, min(60, int(value)))
    except ValueError:
        return None


def ingestion_api_request(
    base_url: str,
    token: str,
    method: str,
    path: str,
    payload: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Retry only transient Newl Apps transport/server failures with bounded backoff."""
    for attempt in range(len(TRANSIENT_RETRY_DELAYS_SECONDS) + 1):
        try:
            return api_request(base_url, token, method, path, payload)
        except NewlAppsRequestError as error:
            if not error.transient or attempt >= len(TRANSIENT_RETRY_DELAYS_SECONDS):
                raise
            delay = error.retry_after
            if delay is None:
                delay = TRANSIENT_RETRY_DELAYS_SECONDS[attempt]
            time.sleep(delay)
    raise RuntimeError("Hunter ingestion retry loop ended unexpectedly")


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


def read_coverage(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Hunter coverage manifest could not be read") from error
    coverage = manifest.get("coverage") if isinstance(manifest, dict) else None
    if not isinstance(coverage, dict):
        raise RuntimeError("Hunter coverage manifest does not contain coverage metrics")

    def integer(name: str) -> int:
        value = coverage.get(name)
        if isinstance(value, bool):
            raise RuntimeError(f"Hunter coverage metric {name} is invalid")
        try:
            normalized = int(value)
        except (TypeError, ValueError) as error:
            raise RuntimeError(f"Hunter coverage metric {name} is invalid") from error
        return max(0, normalized)

    return {
        "matchedRecords": integer("matched_records"),
        "exportedRecords": integer("exported_records"),
        "queryCount": integer("query_count"),
        "exportedQueryCount": integer("exported_query_count"),
        "splitQueryCount": integer("split_query_count"),
        "retrievalComplete": coverage.get("retrieval_complete") is True,
        "maxExportRows": integer("max_export_rows"),
    }


def chunks(values: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def default_checkpoint_path(csv_path: Path, job_run_id: str) -> Path:
    safe_job_run_id = "".join(character for character in job_run_id if character.isalnum() or character in {"-", "_"})
    return csv_path.parent / f".hunter-ingestion-{safe_job_run_id}.json"


def read_checkpoint(
    path: Path,
    *,
    job_run_id: str,
    profile_id: str,
    source_fingerprint: str,
    batch_size: int,
    total_records: int,
    total_batches: int,
) -> dict[str, Any]:
    expected = {
        "version": CHECKPOINT_VERSION,
        "jobRunId": job_run_id,
        "profileId": profile_id,
        "sourceFingerprint": source_fingerprint,
        "batchSize": batch_size,
        "totalRecords": total_records,
        "totalBatches": total_batches,
    }
    if not path.exists():
        return {
            **expected,
            "nextBatchIndex": 0,
            "recordsProcessed": 0,
            "recordsCreated": 0,
            "recordsUpdated": 0,
            "recordsSkipped": 0,
            "completed": False,
        }

    try:
        checkpoint = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Hunter ingestion checkpoint could not be read") from error
    if not isinstance(checkpoint, dict):
        raise RuntimeError("Hunter ingestion checkpoint has an invalid shape")
    mismatches = [key for key, value in expected.items() if checkpoint.get(key) != value]
    if mismatches:
        raise RuntimeError(
            "Hunter ingestion checkpoint does not match the current job and canonical CSV: "
            + ", ".join(mismatches)
        )
    next_batch_index = checkpoint.get("nextBatchIndex")
    if not isinstance(next_batch_index, int) or not 0 <= next_batch_index <= total_batches:
        raise RuntimeError("Hunter ingestion checkpoint has an invalid next batch index")
    for field in ("recordsProcessed", "recordsCreated", "recordsUpdated", "recordsSkipped"):
        if not isinstance(checkpoint.get(field), int) or checkpoint[field] < 0:
            raise RuntimeError(f"Hunter ingestion checkpoint has an invalid {field}")
    return checkpoint


def write_checkpoint(path: Path, checkpoint: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    payload = {
        **checkpoint,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(payload, handle, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        os.chmod(path, 0o600)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--profile-name", default="")
    parser.add_argument("--job-run-id", default="", help="Use a job run created by the coordinating worker.")
    parser.add_argument("--canonical-csv", required=True)
    parser.add_argument("--coverage-manifest", default="")
    parser.add_argument("--destination-market", default="")
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--checkpoint", default="", help="Resume a matching canonical CSV ingestion checkpoint.")
    args = parser.parse_args()

    if args.batch_size < 1 or args.batch_size > 500:
        raise RuntimeError("--batch-size must be between 1 and 500")

    base_url = required_env("NEWL_APPS_BASE_URL")
    token = required_env("INGESTION_API_TOKEN")
    csv_path = Path(args.canonical_csv).expanduser().resolve()
    rows = read_canonical_rows(csv_path)
    records, rejected_before_upload = prepare_records(rows, clean(args.destination_market))
    coverage = read_coverage(Path(args.coverage_manifest).expanduser().resolve()) if args.coverage_manifest else None

    job_run_id = clean(args.job_run_id)
    if not job_run_id:
        # Job creation is not safely idempotent without a coordinating job ID.
        # The Hunter worker always supplies one; standalone callers fail visibly
        # instead of risking a duplicate tracked run after a lost response.
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

    source_fingerprint = file_sha256(csv_path)
    record_batches = list(chunks(records, args.batch_size))
    checkpoint_path = (
        Path(args.checkpoint).expanduser().resolve()
        if clean(args.checkpoint)
        else default_checkpoint_path(csv_path, job_run_id)
    )
    checkpoint = read_checkpoint(
        checkpoint_path,
        job_run_id=job_run_id,
        profile_id=args.profile_id,
        source_fingerprint=source_fingerprint,
        batch_size=args.batch_size,
        total_records=len(records),
        total_batches=len(record_batches),
    )
    resumed_from_batch_index = int(checkpoint["nextBatchIndex"])
    processed = int(checkpoint["recordsProcessed"])
    created = int(checkpoint["recordsCreated"])
    updated = int(checkpoint["recordsUpdated"])
    skipped = int(checkpoint["recordsSkipped"])
    try:
        for batch_index, batch in enumerate(record_batches):
            if batch_index < int(checkpoint["nextBatchIndex"]):
                continue
            batch_response = ingestion_api_request(
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
            checkpoint.update({
                "nextBatchIndex": batch_index + 1,
                "recordsProcessed": processed,
                "recordsCreated": created,
                "recordsUpdated": updated,
                "recordsSkipped": skipped,
                "completed": False,
            })
            write_checkpoint(checkpoint_path, checkpoint)

        ingestion_api_request(
            base_url,
            token,
            "PATCH",
            f"/api/integrations/trademining/job-runs/{job_run_id}",
            {
                "status": "COMPLETED" if coverage is None or coverage["retrievalComplete"] else "PARTIAL",
                "recordsProcessed": processed,
                "recordsCreated": created,
                "recordsUpdated": updated,
                "metadata": {
                    "agent": "Hunter",
                    "recordsSkipped": skipped,
                    "recordsRejectedBeforeUpload": rejected_before_upload,
                    "ingestionCheckpoint": {
                        "sourceFingerprint": source_fingerprint,
                        "batchSize": args.batch_size,
                        "totalBatches": len(record_batches),
                        "nextBatchIndex": len(record_batches),
                        "completed": True,
                    },
                    **({"coverage": coverage} if coverage is not None else {}),
                },
            },
        )
        checkpoint["completed"] = True
        write_checkpoint(checkpoint_path, checkpoint)
    except Exception as error:
        try:
            ingestion_api_request(
                base_url,
                token,
                "PATCH",
                f"/api/integrations/trademining/job-runs/{job_run_id}",
                {
                    "status": "FAILED",
                    "errorMessage": str(error)[:500],
                    "recordsProcessed": processed,
                    "recordsCreated": created,
                    "recordsUpdated": updated,
                    "metadata": {
                        "agent": "Hunter",
                        "recordsProcessedBeforeFailure": processed,
                        "recordsSkippedBeforeFailure": skipped,
                        "ingestionCheckpoint": {
                            "sourceFingerprint": source_fingerprint,
                            "batchSize": args.batch_size,
                            "totalBatches": len(record_batches),
                            "nextBatchIndex": int(checkpoint["nextBatchIndex"]),
                            "completed": False,
                        },
                    },
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
        "checkpointPath": str(checkpoint_path),
        "resumedFromBatchIndex": resumed_from_batch_index,
        "coverage": coverage,
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Hunter ingestion failed: {error}", file=sys.stderr)
        raise SystemExit(1)
