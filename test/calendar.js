import { parseAgenda } from "../lib/calendar.js";
const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iCloud//EN
BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
DTSTART:19810329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZNAME:BST
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
DTSTART:19961027T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZNAME:GMT
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:a1
DTSTART;TZID=Europe/London:20260930T140000
DTEND;TZID=Europe/London:20260930T150000
SUMMARY:Valuation call
LOCATION:Phone
END:VEVENT
BEGIN:VEVENT
UID:a2
DTSTART;TZID=Europe/London:20260907T090000
DTEND;TZID=Europe/London:20260907T093000
RRULE:FREQ=WEEKLY;BYDAY=MO
SUMMARY:Monday pipeline review
END:VEVENT
BEGIN:VEVENT
UID:a3
DTSTART;VALUE=DATE:20261002
DTEND;VALUE=DATE:20261003
SUMMARY:VAT return due
END:VEVENT
BEGIN:VEVENT
UID:a4
DTSTART;TZID=Europe/London:20261029T100000
DTEND;TZID=Europe/London:20261029T110000
SUMMARY:After the clocks change
END:VEVENT
BEGIN:VEVENT
UID:old
DTSTART;TZID=Europe/London:20260901T100000
DTEND;TZID=Europe/London:20260901T110000
SUMMARY:Old meeting
END:VEVENT
END:VCALENDAR`;
const out = parseAgenda(ics, 7, new Date("2026-09-30T09:00:00Z"));
console.log(JSON.stringify(out, null, 1));
const want = [["2026-09-30","14:00","Valuation call"],["2026-10-02",null,"VAT return due"],["2026-10-05","09:00","Monday pipeline review"]];
const got = out.map(e => [e.date, e.start, e.title]);
const pass = JSON.stringify(got) === JSON.stringify(want);
console.log(pass ? "CALENDAR OK" : "CALENDAR MISMATCH " + JSON.stringify(got));
const late = parseAgenda(ics, 7, new Date("2026-10-28T09:00:00Z")).find(e => e.title === "After the clocks change");
console.log(late?.start === "10:00" ? "GMT OK" : "GMT WRONG " + JSON.stringify(late));
