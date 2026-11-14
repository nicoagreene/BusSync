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

| Spare time             | Meaning                   |
| ---------------------- | ------------------------- |
| 10 min or more         | green: feasible           |
| 5–10 min              | yellow: possibly feasible |
| under 5 min, or no bus | red: not feasible         |

Times over an hour are shown as hours and minutes (e.g. `1 hr 25 min`).

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

UI notes : distinguish reds better, full name on dropdown, configurable buffer times, make othe cart different from the schedule, convertes minus>60 to hours and minutes, emphasize time. dropdown on day? Change day header? For setting do > 10 good, <10 and >5 reasonable and >5 not good. Add, manual event time place.

Have name of class as main, code underneath. Make it more clear which classes cause conflicts. Say until instead of 'reach' for bus to class. Group conflicting classes together.

Worker link: https://bussynccalendar.workers.dev

[bussync-cal.bussynccalendar.workers.dev](https://bussync-cal.bussynccalendar.workers.dev)

Change subdomain;
[dash.cloudflare.com/65a5c5ee232644f55aff072f39ea44c4/workers/subdomain](https://dash.cloudflare.com/65a5c5ee232644f55aff072f39ea44c4/workers/subdomain)



## Layout

- `content/` — injects the Add buttons on search results
- `sidepanel/` — cart, home campus, week plan
- `lib/parse.js` — day/time parsing shared by both
- `lib/planner.js` — conflicts and bus-leg planning (pure, unit tested)
- `scripts/parse_schedules.py` — timetable HTML → `data/buses.json`
