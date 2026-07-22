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
import time
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

LOOKUP_ALIASES = {
    ("ForeignPort", "busan"): "Pusan",
}


@dataclass
class TradeMiningSession:
    cookie_file: Path

    def request(
        self,
        method: str,
        path_or_url: str,
        data: Optional[dict[str, str | list[str]]] = None,
        output: Optional[Path] = None,
        extra_headers: Optional[dict[str, str]] = None,
    ) -> tuple[int, dict[str, str], bytes]:
        url = path_or_url if path_or_url.startswith("http") else BASE_URL + path_or_url
        encoded = None if data is None else urllib.parse.urlencode(data, doseq=True).encode()
        headers = {
            "User-Agent": "Newl-Hunter-TradeMining-Collector/1.0",
            "Accept": "*/*",
        }
        if encoded is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        if extra_headers:
            headers.update(extra_headers)

        cookie_header = self._cookie_header()
        if cookie_header:
            headers["Cookie"] = cookie_header

        req = urllib.request.Request(url, data=encoded, headers=headers, method=method)
        opener = urllib.request.build_opener(NoRedirectHandler)

        response = None
        attempts = max(1, int(os.environ.get("HUNTER_HTTP_MAX_ATTEMPTS", "4")))
        for attempt in range(1, attempts + 1):
            try:
                response = opener.open(req, timeout=120)
            except urllib.error.HTTPError as exc:
                response = exc
            except urllib.error.URLError:
                if attempt >= attempts:
                    raise
                time.sleep(min(2 ** (attempt - 1), 8))
                continue

            if response.status not in (429, 500, 502, 503, 504) or attempt >= attempts:
                break
            response.read()
            time.sleep(min(2 ** (attempt - 1), 8))

        if response is None:
            raise RuntimeError("TradeMining request did not return a response")

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

    def post_follow(self, path: str, data: dict[str, str | list[str]]) -> str:
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
    port_ids: list[str],
    start_date: dt.date,
    end_date: dt.date,
    origin_country_ids: Optional[list[str]] = None,
    origin_port_ids: Optional[list[str]] = None,
    ship_from_ports: Optional[list[str]] = None,
    product_keywords: Optional[list[str]] = None,
    hs_codes: Optional[list[str]] = None,
    minimum_teu: Optional[float] = None,
) -> tuple[str, str]:
    page = session.get_text("/ImportSearch")
    data = build_search_form(
        token=anti_forgery_token(page),
        port_ids=port_ids,
        start_date=start_date,
        end_date=end_date,
        origin_country_ids=origin_country_ids or [],
        origin_port_ids=origin_port_ids or [],
        ship_from_ports=ship_from_ports or [],
        product_keywords=product_keywords or [],
        hs_codes=hs_codes or [],
        minimum_teu=minimum_teu,
    )
    result = session.post_follow("/ImportSearch/Data", data)
    match = re.search(r'value=(\d+) id="Id"', result)
    if not match:
        raise RuntimeError("search log id not found in TradeMining result page")
    return match.group(1), result


def build_search_form(
    token: str,
    port_ids: list[str],
    start_date: dt.date,
    end_date: dt.date,
    origin_country_ids: list[str],
    origin_port_ids: list[str],
    ship_from_ports: list[str],
    product_keywords: list[str],
    hs_codes: list[str],
    minimum_teu: Optional[float],
) -> dict[str, str | list[str]]:
    if not port_ids:
        raise RuntimeError("at least one TradeMining US port is required")

    data: dict[str, str | list[str]] = {
        "__RequestVerificationToken": token,
        "TradeStartDate": start_date.strftime("%m/%d/%Y"),
        "TradeEndDate": end_date.strftime("%m/%d/%Y"),
        "BillTypeHouse": "on",
        "BillTypeStraight": "on",
        "ContainerLoad": "All",
        "ContainerFlag": "All",
        "USPort": port_ids,
        "ShipmentDestinationAll": "on",
        "SaveSearchId": "",
        "RollUpType": "None",
    }
    if origin_country_ids:
        data["CountryOfOrigin"] = origin_country_ids
    if origin_port_ids:
        data["ForeignPort"] = origin_port_ids
    if ship_from_ports:
        data["PlaceOfReceipt"] = boolean_or_expression(ship_from_ports)
    if product_keywords:
        data["ContainerCommodity"] = boolean_or_expression(product_keywords)
    if hs_codes:
        data["HTSCode"] = comma_separated_values(hs_codes)
    if minimum_teu is not None:
        data["TEUSingle"] = "TEUSingle"
        data["TEUFromSingle"] = "Greater Than Or Equals To"
        data["TEUToSingle"] = format(minimum_teu, "g")
    return data


def boolean_or_expression(values: list[str]) -> str:
    unique: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = re.sub(r"\s+", " ", str(raw)).strip()
        if not value or value.casefold() in seen:
            continue
        seen.add(value.casefold())
        escaped = value.replace('"', '\\"')
        unique.append(f'"{escaped}"' if " " in escaped else escaped)
    return " OR ".join(unique)


def comma_separated_values(values: list[str]) -> str:
    unique: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = re.sub(r"\s+", "", str(raw)).strip(",")
        if not value or value.casefold() in seen:
            continue
        seen.add(value.casefold())
        unique.append(value)
    return ",".join(unique)


def resolve_lookup_ids(session: TradeMiningSession, field: str, values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        query = lookup_query(field, value)
        status, _headers, body = session.request("POST", f"/AutoComplete/{field}", {"text": query})
        if status != 200:
            raise RuntimeError(f"TradeMining {field} lookup failed with status {status}")
        try:
            matches = json.loads(body.decode("utf-8", "replace"))
        except json.JSONDecodeError as error:
            raise RuntimeError(f"TradeMining {field} lookup returned invalid JSON") from error
        if not isinstance(matches, list):
            raise RuntimeError(f"TradeMining {field} lookup returned an unexpected response")

        exact = [
            match
            for match in matches
            if isinstance(match, dict)
            and str(match.get("lookupName", "")).strip().casefold() == query.casefold()
            and str(match.get("lookupId", "")).strip()
        ]
        candidates = exact or [
            match
            for match in matches
            if isinstance(match, dict) and str(match.get("lookupId", "")).strip()
        ]
        if len(candidates) != 1:
            raise RuntimeError(f'TradeMining {field} lookup for "{value}" was not uniquely resolved')
        result.append(str(candidates[0]["lookupId"]).strip())
    return result


def lookup_query(field: str, value: str) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    return LOOKUP_ALIASES.get((field, normalized.casefold()), normalized)


def extract_result_columns(result_page: str) -> dict[str, Any]:
    match = re.search(r"var resultTemplate = (\{.*?\});\s*var bolImportRollupType", result_page, re.S)
    if not match:
        raise RuntimeError("result template not found")
    return json.loads(match.group(1))


def search_result_count(session: TradeMiningSession, search_log_id: str) -> int:
    query = urllib.parse.urlencode({"page": 1, "pageSize": 1, "skip": 0, "take": 1})
    status, _headers, body = session.request(
        "GET",
        f"/ImportSearch/Results/{search_log_id}?{query}",
        extra_headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"},
    )
    if status != 200:
        raise RuntimeError(f"TradeMining result count failed with status {status}")
    try:
        parsed = json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError as error:
        raise RuntimeError("TradeMining result count returned invalid JSON") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("TradeMining result count returned an unexpected response")
    return max(0, int(parsed.get("ResultCount") or 0))


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
    parser.add_argument("--chunk-days", type=int, default=0, help="Optional manual recovery split; daily profiles use one query.")
    parser.add_argument("--origin-country", action="append", default=[])
    parser.add_argument("--origin-port", action="append", default=[])
    parser.add_argument("--ship-from-port", action="append", default=[])
    parser.add_argument("--product-keyword", action="append", default=[])
    parser.add_argument("--hs-code", action="append", default=[])
    parser.add_argument("--minimum-teu", type=float)
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
    origin_country_ids = resolve_lookup_ids(session, "CountryOfOrigin", args.origin_country)
    origin_port_ids = resolve_lookup_ids(session, "ForeignPort", args.origin_port)

    selected_ports: list[tuple[str, str, str]] = []
    for port_key in requested_ports:
        if port_key not in ports:
            raise RuntimeError(f"unknown port key: {port_key}")
        port_name, port_id = ports[port_key]
        selected_ports.append((port_key, port_name, port_id))
    port_ids = [port_id for _port_key, _port_name, port_id in selected_ports]
    port_names = [port_name for _port_key, port_name, _port_id in selected_ports]

    manifest = {
        "run_date": end_date.isoformat(),
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "chunk_days": args.chunk_days,
        "ports": [],
    }

    for window_start, window_end in windows:
        print(
            f"running one profile query for {len(selected_ports)} ports {window_start}..{window_end}",
            file=sys.stderr,
        )
        search_log_id, result_page = run_search(
            session,
            port_ids,
            window_start,
            window_end,
            origin_country_ids=origin_country_ids,
            origin_port_ids=origin_port_ids,
            ship_from_ports=args.ship_from_port,
            product_keywords=args.product_keyword,
            hs_codes=args.hs_code,
            minimum_teu=args.minimum_teu,
        )
        result_count = search_result_count(session, search_log_id)
        date_slug = f"{window_start.isoformat()}_to_{window_end.isoformat()}"
        xlsx_path = run_dir / f"{date_slug}_profile_{search_log_id}.xlsx"
        csv_path = run_dir / f"{date_slug}_profile_{search_log_id}.csv"
        if result_count == 0:
            xlsx_manifest_path: Optional[str] = None
            csv_path.write_text("")
            data_rows = 0
        else:
            export_excel(session, search_log_id, result_page, xlsx_path)
            rows = xlsx_to_rows(xlsx_path)
            data_rows = write_csv(rows, csv_path)
            xlsx_manifest_path = str(xlsx_path)
        manifest["ports"].append(
            {
                "port_key": "profile-query",
                "port_name": ", ".join(port_names),
                "port_id": ",".join(port_ids),
                "port_names": port_names,
                "port_ids": port_ids,
                "window_start_date": window_start.isoformat(),
                "window_end_date": window_end.isoformat(),
                "search_log_id": search_log_id,
                "xlsx": xlsx_manifest_path,
                "csv": str(csv_path),
                "data_rows": data_rows,
                "result_count": result_count,
                "filters": {
                    "origin_countries": args.origin_country,
                    "origin_ports": args.origin_port,
                    "ship_from_ports": args.ship_from_port,
                    "product_keywords": args.product_keyword,
                    "hs_codes": args.hs_code,
                    "minimum_teu": args.minimum_teu,
                },
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
