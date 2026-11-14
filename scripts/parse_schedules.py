#!/usr/bin/env python3
"""Convert the saved Blue Bus / Tri-Co Van pages into data/buses.json.

Usage (from the repo root):
    python3 -I scripts/parse_schedules.py

Re-run whenever the timetables change: save the new pages over
schedule/blue_bus.html and schedule/trico_van.html first.

Only weekday tables shaped "Leaves A | Arrives B | Leaves B | Arrives A" are
used; weekend tables are skipped because the planner covers Monday-Friday.
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = [
    ("Blue Bus", ROOT / "schedule" / "blue_bus.html"),
    ("Tri-Co Van", ROOT / "schedule" / "trico_van.html"),
]
OUT = ROOT / "data" / "buses.json"

WEEKDAYS = ["M", "T", "W", "Th", "F"]
DAY_WORDS = {"monday": "M", "tuesday": "T", "wednesday": "W", "thursday": "Th", "friday": "F"}
CAMPUSES = {"BMC", "HC", "SC"}
TIME_RE = re.compile(r"^(\d{1,2})(?::(\d\d))?\s*([ap])$")


def text(fragment):
    s = re.sub(r"<br\s*/?>", " ", fragment)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s).replace("\xa0", " ")).strip()


def table_days(title):
    t = title.lower()
    if "weekday" in t:
        return list(WEEKDAYS)
    return [code for word, code in DAY_WORDS.items() if word in t]


def to_minutes(token):
    m = TIME_RE.match(token)
    if not m:
        raise ValueError(f"bad time {token!r}")
    hour, minute, ampm = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ampm == "p" and hour != 12:
        hour += 12
    if ampm == "a" and hour == 12:
        hour = 0
    total = hour * 60 + minute
    # Small-hours trips (12a-4a) belong to the previous service day.
    if ampm == "a" and hour < 5:
        total += 24 * 60
    return total


def parse_cell(cell):
    """Return (times, restriction) for one cell.

    "12:55p & 1:00p" -> two departures. "(+)" -> Mon-Thu only, "(F)" -> Fri only.
    Blank or "--" -> no times.
    """
    restriction = None
    if "(+)" in cell:
        restriction = ["M", "T", "W", "Th"]
    elif "(F)" in cell:
        restriction = ["F"]
    cleaned = re.sub(r"\([^)]*\)", "", cell).strip()
    if not cleaned or cleaned.startswith("--"):
        return [], restriction
    return [to_minutes(p.strip()) for p in cleaned.split("&")], restriction


def half_row_trips(route, frm, to, dep_cell, arr_cell, days):
    deps, r1 = parse_cell(dep_cell)
    arrs, r2 = parse_cell(arr_cell)
    if not deps or not arrs:
        return []
    restriction = r1 or r2
    trip_days = [d for d in days if restriction is None or d in restriction]
    if not trip_days:
        return []
    arrive = arrs[0]
    duration = arrive - deps[0]
    trips = []
    for i, dep in enumerate(deps):
        # "A & B" lists two buses; the printed arrival belongs to the first,
        # so later ones are assumed to take the same travel time.
        arr = arrive if i == 0 else dep + duration
        trips.append({"route": route, "from": frm, "to": to, "depart": dep, "arrive": arr, "days": trip_days})
    return trips


def parse_page(route, path):
    s = path.read_text(encoding="utf-8")
    trips = []
    for table in re.findall(r"<table.*?</table>", s, re.S):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)
        if len(rows) < 3:
            continue
        title = text(rows[0])
        days = table_days(title)
        headers = [text(h).split() for h in re.findall(r"<th[^>]*>(.*?)</th>", rows[1], re.S)]
        shape_ok = (
            len(headers) == 4
            and all(len(h) == 2 for h in headers)
            and [h[0] for h in headers] == ["Leaves", "Arrives", "Leaves", "Arrives"]
        )
        if not days or not shape_ok:
            continue
        a, b = headers[0][1], headers[1][1]
        if {a, b} - CAMPUSES or headers[2][1] != b or headers[3][1] != a:
            continue
        for row in rows[2:]:
            cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(cells) != 4:
                continue
            trips += half_row_trips(route, a, b, cells[0], cells[1], days)
            trips += half_row_trips(route, b, a, cells[2], cells[3], days)
    return trips


def main():
    trips = []
    for route, path in SOURCES:
        trips += parse_page(route, path)
    trips.sort(key=lambda t: (t["from"], t["to"], t["depart"], t["route"]))
    for t in trips:
        if t["arrive"] <= t["depart"]:
            sys.exit(f"Trip arrives before it departs: {t}")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"trips": trips}, indent=1) + "\n", encoding="utf-8")

    print(f"Wrote {len(trips)} trips to {OUT.relative_to(ROOT)}")
    for day in WEEKDAYS:
        counts = {}
        for t in trips:
            if day in t["days"]:
                key = f"{t['route']} {t['from']}->{t['to']}"
                counts[key] = counts.get(key, 0) + 1
        print(f"  {day:2} " + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
