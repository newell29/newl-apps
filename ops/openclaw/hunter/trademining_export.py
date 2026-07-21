#!/usr/bin/env python3
"""Run Hunter TradeMining BOL searches and archive exported Excel/CSV results.

This script intentionally avoids browser automation. TradeMining's site uses
standard form posts for search and Excel export, so a cookie session is enough.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from xml.etree import ElementTree


BASE_URL = "https://www.trademining.com"

PORTS = {
    "charleston": ("Charleston, South Carolina", "1237"),
    "savannah": ("Savannah, Georgia", "1241"),
    "jacksonville": ("Area Port of Jacksonville, Florida", "1244"),
    "wilmington-nc": ("Wilmington, North Carolina", "1233"),
    "norfolk": ("Norfolk-Newport News, Virginia", "1228"),
}


@dataclass
class TradeMiningSession:
    cookie_file: Path

    def request(
        self,
        method: str,
        path_or_url: str,
        data: Optional[dict[str, str]] = None,
        output: Optional[Path] = None,
    ) -> tuple[int, dict[str, str], bytes]:
        url = path_or_url if path_or_url.startswith("http") else BASE_URL + path_or_url
        encoded = None if data is None else urllib.parse.urlencode(data).encode()
        headers = {
            "User-Agent": "Newl-Hunter-TradeMining-Collector/1.0",
            "Accept": "*/*",
        }
        if encoded is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"

        cookie_header = self._cookie_header()
        if cookie_header:
            headers["Cookie"] = cookie_header

        req = urllib.request.Request(url, data=encoded, headers=headers, method=method)
        opener = urllib.request.build_opener(NoRedirectHandler)

        try:
            response = opener.open(req, timeout=120)
        except urllib.error.HTTPError as exc:
            response = exc

        body = response.read()
        self._store_set_cookies(response.headers.get_all("Set-Cookie") or [])

        if output is not None:
            output.write_bytes(body)

        return response.status, {k.lower(): v for k, v in response.headers.items()}, body

    def get_text(self, path_or_url: str) -> str:
        status, headers, body = self.request("GET", path_or_url)
        if status in (301, 302, 303, 307, 308):
            location = headers["location"]
            return self.get_text(location)
        return body.decode("utf-8", "replace")

    def post_follow(self, path: str, data: dict[str, str]) -> str:
        status, headers, body = self.request("POST", path, data)
        redirects = 0
        while status in (301, 302, 303, 307, 308):
            redirects += 1
            if redirects > 5:
                raise RuntimeError("too many redirects")
            location = headers["location"]
            status, headers, body = self.request("GET", location)
        return body.decode("utf-8", "replace")

    def _cookie_header(self) -> str:
        if not self.cookie_file.exists():
            return ""
        cookies: list[str] = []
        for line in self.cookie_file.read_text().splitlines():
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) >= 7:
                cookies.append(f"{parts[5]}={parts[6]}")
        return "; ".join(cookies)

    def _store_set_cookies(self, set_cookies: list[str]) -> None:
        existing: dict[str, str] = {}
        if self.cookie_file.exists():
            for line in self.cookie_file.read_text().splitlines():
                if line and not line.startswith("#"):
                    parts = line.split("\t")
                    if len(parts) >= 7:
                        existing[parts[5]] = parts[6]
        for raw in set_cookies:
            name_value = raw.split(";", 1)[0]
            if "=" not in name_value:
                continue
            name, value = name_value.split("=", 1)
            existing[name] = value
        lines = [
            "# Netscape HTTP Cookie File",
            *[
                "\t".join(["www.trademining.com", "FALSE", "/", "TRUE", "0", name, value])
                for name, value in existing.items()
            ],
        ]
        self.cookie_file.parent.mkdir(parents=True, exist_ok=True)
        self.cookie_file.write_text("\n".join(lines) + "\n")
        self.cookie_file.chmod(0o600)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        return None


def anti_forgery_token(page: str) -> str:
    match = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', page)
    if not match:
        raise RuntimeError("anti-forgery token not found")
    return match.group(1)


def login(session: TradeMiningSession, email: str, password: str) -> None:
    page = session.get_text("/Account/LogIn")
    data = {
        "Email": email,
        "Password": password,
        "RememberMe": "true",
        "__RequestVerificationToken": anti_forgery_token(page),
    }
    result = session.post_follow("/Account/Login", data)
    if "/Account/LogOut" not in result and "Sign Out" not in result:
        raise RuntimeError("TradeMining login did not appear to succeed")


def run_search(
    session: TradeMiningSession,
    port_id: str,
    start_date: dt.date,
    end_date: dt.date,
) -> tuple[str, str]:
    page = session.get_text("/ImportSearch")
    data = {
        "__RequestVerificationToken": anti_forgery_token(page),
        "TradeStartDate": start_date.strftime("%m/%d/%Y"),
        "TradeEndDate": end_date.strftime("%m/%d/%Y"),
        "BillTypeHouse": "on",
        "BillTypeStraight": "on",
        "ContainerLoad": "All",
        "ContainerFlag": "All",
        "USPort": port_id,
        "ShipmentDestinationAll": "on",
        "SaveSearchId": "",
        "RollUpType": "None",
    }
    result = session.post_follow("/ImportSearch/Data", data)
    match = re.search(r'value=(\d+) id="Id"', result)
    if not match:
        raise RuntimeError("search log id not found in TradeMining result page")
    return match.group(1), result


def extract_result_columns(result_page: str) -> dict[str, Any]:
    match = re.search(r"var resultTemplate = (\{.*?\});\s*var bolImportRollupType", result_page, re.S)
    if not match:
        raise RuntimeError("result template not found")
    return json.loads(match.group(1))


def export_excel(
    session: TradeMiningSession,
    search_log_id: str,
    result_page: str,
    output_path: Path,
) -> None:
    state = {"columns": extract_result_columns(result_page)["columns"]}
    data = {
        "jsonString": json.dumps(state),
        "sort": "",
        "filter": "",
        "ExcelPageNumber": "0",
    }
    status, headers, body = session.request(
        "POST",
        f"/ImportSearch/ExportToExcel/{search_log_id}",
        data,
        output_path,
    )
    if status != 200 or not body.startswith(b"PK"):
        raise RuntimeError(f"Excel export failed with status {status} and content-type {headers.get('content-type')}")


def xlsx_to_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in root.findall(".//{*}si"):
                shared.append("".join(t.text or "" for t in si.findall(".//{*}t")))
        root = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    rows: list[list[str]] = []
    for row_node in root.findall(".//{*}sheetData/{*}row"):
        cells: dict[int, str] = {}
        for cell in row_node.findall("{*}c"):
            ref_value = cell.attrib.get("r", "")
            ref = re.match(r"([A-Z]+)(\d+)", ref_value)
            if ref is None:
                continue
            col_index = excel_col_to_index(ref.group(1))
            cell_type = cell.attrib.get("t")
            value_node = cell.find("{*}v")
            inline_node = cell.find(".//{*}t")
            value = ""
            if value_node is not None and value_node.text is not None:
                raw = value_node.text
                if cell_type == "s":
                    value = shared[int(raw)]
                else:
                    value = raw
            elif inline_node is not None and inline_node.text is not None:
                value = inline_node.text
            cells[col_index] = value
        if cells:
            max_col = max(cells)
            rows.append([cells.get(i, "") for i in range(max_col + 1)])
        else:
            rows.append([])
    return rows


def excel_col_to_index(col: str) -> int:
    value = 0
    for char in col:
        value = value * 26 + (ord(char) - ord("A") + 1)
    return value - 1


def write_csv(rows: list[list[str]], output_path: Path) -> int:
    # TradeMining exports have intro rows before the header. The header row is
    # the first row containing "Country Of Origin" and "Consignee Name".
    header_index = None
    for index, row in enumerate(rows):
        joined = "\t".join(row)
        if "Country Of Origin" in joined and "Consignee Name" in joined:
            header_index = index
            break
    if header_index is None:
        raise RuntimeError("could not find TradeMining header row")

    table = rows[header_index:]
    if len(table[0]) > 2 and table[0][0] == "" and table[0][1] == "" and table[0][2] == "Country Of Origin":
        table[0][1] = "Arrival Date"
        table = [row[1:] for row in table]
    if len(table[0]) > 1 and table[0][0] == "" and table[0][1] == "Arrival Date":
        table = [row[1:] for row in table]

    max_len = max(len(row) for row in table)
    normalized = [row + [""] * (max_len - len(row)) for row in table]
    if normalized and "Arrival Date" in normalized[0]:
        date_index = normalized[0].index("Arrival Date")
        for row in normalized[1:]:
            row[date_index] = excel_date_to_iso(row[date_index])
    with output_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows(normalized)
    return max(0, len(normalized) - 1)


def excel_date_to_iso(value: str) -> str:
    if not value:
        return ""
    try:
        serial = float(value)
    except ValueError:
        return value
    # Excel's Windows date system, adjusted for the 1900 leap-year bug.
    base = dt.date(1899, 12, 30)
    return (base + dt.timedelta(days=int(serial))).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ports", default="charleston,savannah", help="Comma-separated port keys or 'all'.")
    parser.add_argument(
        "--port-spec",
        action="append",
        default=[],
        help="Additional or replacement port in key|TradeMining display name|TradeMining ID format.",
    )
    parser.add_argument("--days", type=int, default=7, help="Trailing day count ending at --end-date.")
    parser.add_argument("--start-date", default="", help="YYYY-MM-DD. Overrides --days when supplied.")
    parser.add_argument("--end-date", default="", help="YYYY-MM-DD. Defaults to today UTC.")
    parser.add_argument("--chunk-days", type=int, default=0, help="Split date range into chunks of N days.")
    parser.add_argument("--run-slug", default="", help="Optional safe output directory name for this profile run.")
    parser.add_argument(
        "--output-root",
        default=os.environ.get("HUNTER_EXPORT_DIRECTORY", "data/trademining/raw"),
    )
    parser.add_argument(
        "--cookie-file",
        default=os.environ.get(
            "HUNTER_COOKIE_FILE",
            str(Path.home() / ".openclaw" / "agents" / "hunter" / "runtime" / "trademining.cookies"),
        ),
    )
    args = parser.parse_args()

    email = os.environ.get("TRADEMINING_USER")
    password = os.environ.get("TRADEMINING_PASSWORD")
    if not email or not password:
        raise RuntimeError("TRADEMINING_USER and TRADEMINING_PASSWORD are required")

    ports = parse_port_specs(args.port_spec)

    end_date = dt.date.fromisoformat(args.end_date) if args.end_date else dt.datetime.now(dt.timezone.utc).date()
    start_date = dt.date.fromisoformat(args.start_date) if args.start_date else end_date - dt.timedelta(days=args.days - 1)
    windows = date_windows(start_date, end_date, args.chunk_days)
    requested_ports = list(ports) if args.ports == "all" else [p.strip() for p in args.ports.split(",") if p.strip()]

    output_root = Path(args.output_root)
    run_slug = args.run_slug.strip() or end_date.isoformat()
    if not args.run_slug and (args.start_date or args.chunk_days > 0):
        run_slug = f"{start_date.isoformat()}_to_{end_date.isoformat()}"
    run_dir = output_root / run_slug
    run_dir.mkdir(parents=True, exist_ok=True)

    session = TradeMiningSession(Path(args.cookie_file).expanduser())
    login(session, email, password)

    manifest = {
        "run_date": end_date.isoformat(),
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "chunk_days": args.chunk_days,
        "ports": [],
    }

    for window_start, window_end in windows:
        for port_key in requested_ports:
            if port_key not in ports:
                raise RuntimeError(f"unknown port key: {port_key}")
            port_name, port_id = ports[port_key]
            print(f"running {port_key} {window_start}..{window_end}", file=sys.stderr)
            search_log_id, result_page = run_search(session, port_id, window_start, window_end)
            date_slug = f"{window_start.isoformat()}_to_{window_end.isoformat()}"
            xlsx_path = run_dir / f"{date_slug}_{port_key}_{search_log_id}.xlsx"
            csv_path = run_dir / f"{date_slug}_{port_key}_{search_log_id}.csv"
            export_excel(session, search_log_id, result_page, xlsx_path)
            rows = xlsx_to_rows(xlsx_path)
            data_rows = write_csv(rows, csv_path)
            manifest["ports"].append(
                {
                    "port_key": port_key,
                    "port_name": port_name,
                    "port_id": port_id,
                    "window_start_date": window_start.isoformat(),
                    "window_end_date": window_end.isoformat(),
                    "search_log_id": search_log_id,
                    "xlsx": str(xlsx_path),
                    "csv": str(csv_path),
                    "data_rows": data_rows,
                }
            )

    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0


def parse_port_specs(values: list[str]) -> dict[str, tuple[str, str]]:
    ports = dict(PORTS)
    for value in values:
        parts = [part.strip() for part in value.split("|", 2)]
        if len(parts) != 3 or not all(parts):
            raise RuntimeError("--port-spec must use key|TradeMining display name|TradeMining ID format")
        key, display_name, port_id = parts
        if not re.fullmatch(r"[a-z0-9-]+", key):
            raise RuntimeError(f"invalid port key: {key}")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", port_id):
            raise RuntimeError(f"invalid TradeMining port ID for {key}")
        ports[key] = (display_name, port_id)
    return ports


def date_windows(start_date: dt.date, end_date: dt.date, chunk_days: int) -> list[tuple[dt.date, dt.date]]:
    if start_date > end_date:
        raise RuntimeError("--start-date cannot be after --end-date")
    if chunk_days <= 0:
        return [(start_date, end_date)]
    windows: list[tuple[dt.date, dt.date]] = []
    current = start_date
    while current <= end_date:
        window_end = min(current + dt.timedelta(days=chunk_days - 1), end_date)
        windows.append((current, window_end))
        current = window_end + dt.timedelta(days=1)
    return windows


if __name__ == "__main__":
    raise SystemExit(main())
