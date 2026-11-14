# BusSync

A Chrome extension for the [Tri-Co Course Guide](https://www.swarthmore.edu/tricollege-course-guide/tricollege-course-guide).
Add courses to a cart from the search results, and the side panel shows, for each weekday, which
Blue Bus or Tri-Co Van to take between your classes, and flags any conflicts.

## Install (developer mode)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Click the BusSync toolbar icon to open the side panel, and pick your home campus.
4. Search the Course Guide; each result gets a **+ Add** button (click again to remove).

## How feasibility is judged
For every trip between campuses, BusSync takes the smaller of the time you have to walk from
class to the stop and from the stop to your next class:

| Spare time | Meaning |
| --- | --- |
| over 7 min | green: feasible |
| 3–7 min | yellow: possibly feasible |
| under 3 min, or no bus | red: not feasible |

Classes that overlap get a red marker and sit next to each other in the cart and the week view.
Bryn Mawr ↔ Swarthmore may also be routed Blue Bus + Van through Haverford.

## Updating bus timetables
Save the current [Blue Bus](https://www.brynmawr.edu/inside/offices-services/transportation/blue-bus)
and [Tri-Co Van](https://www.brynmawr.edu/inside/offices-services/transportation/tri-co-van) pages
over `schedule/blue_bus.html` and `schedule/trico_van.html`, then run:

```
npm run schedules   # rewrites data/buses.json and prints trip counts per day
npm test
```

## Layout
- `content/` — injects the Add buttons on search results
- `sidepanel/` — cart, home campus, week plan
- `lib/parse.js` — day/time parsing shared by both
- `lib/planner.js` — conflicts and bus-leg planning (pure, unit tested)
- `scripts/parse_schedules.py` — timetable HTML → `data/buses.json`
