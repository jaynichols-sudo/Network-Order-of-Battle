# Bearings design: "Calm cards"

The app's visual language. iPhone (SwiftUI) and Android (`src/android`) follow the same spec.

## Colors

| Token | Light | Dark |
|---|---|---|
| bg (screen) | #F3F3F6 | #0D0A17 |
| card | #FFFFFF | #17132A |
| card2 (inset fill, secondary buttons) | #F3F3F6 | #221C38 |
| line (hairline inside cards) | #F0EFF4 | rgba(255,255,255,.07) |
| text | #1A1726 | #F2EEFF |
| text2 (secondary) | #7A7590 | #9C95B8 |
| text3 (tertiary, times) | #9A96AC | #6F6890 |
| primary (main buttons, active tab) | #2A2448 (white text) | #FFB020 (text #1B1830) |
| soft (secondary pill bg) | #EEEDF4 | #2A2440 |
| needs-you amber (counts, Reply tag) | #C77700 | #FFB020 |
| good | #227A66 on #E4F3EE | #3DD4A3 on rgba(61,212,163,.14) |

Cards: radius 20 (continuous), shadow `0 1px 2px rgba(20,16,40,.05), 0 6px 20px rgba(20,16,40,.05)` in light, no shadow but a 1px rgba(255,255,255,.06) border in dark. Screen side padding 16, gap between cards 12, inner card padding 16.

Pills: height 32–34, full radius. Avatars: initials on a pale sector tint (existing tint at ~18%).

Type: Geist. Screen title 28 bold, card title 17 bold, row name 15 semibold, row detail 13 text2. Numbers can stay Geist Mono where they are data.

## Navigation: four tabs

**Today, People, Companies, You.** Explore and Catch Up are no longer tabs.

- **Explore** (compass, map, clusters) opens from Today by tapping the compass card.
- **Catch Up** opens from Today's "N to catch up" chip.
- Lists, events, trips and saved searches are reached from chips on Today and from the You tab.

## Today

From top to bottom:

1. **Header.**
   - Small date line, e.g. "Monday, October 5", in text2.
   - Headline (28 bold): "Five people need you this week." Use the count of open weekly picks, spelled out up to ten. Use "One person needs you this week." for one, and "You're all caught up." when there are none.
   - Avatar button on the right.
2. **Banner callout** when there is one (error, syncing, import, refresh due), as a card.
3. **Compass card.**
   - The compass (about 128pt) sits on the left; tapping it opens Explore.
   - Three stats sit on the right: waiting on you (big, amber), new jobs, close. Each stat opens People filtered to it.
4. **"Needs you" card.**
   - Title "Needs you", with "N of 5 done" on the right.
   - Rows for the weekly picks: avatar, name, one-line why, and a pill action button.
   - The first actions (Reply) use primary fill; the others use the soft pill.
   - Done rows show the name struck through in text3, with a good-colored "Done" pill.
5. **Chip row** (white pills, wraps):
   - "27 to catch up"
   - one chip per list ("Lists · 3")
   - events with follow-ups ("TechNet · 3")
   - active or upcoming trip
   - saved searches
6. **Further cards only when they have content:**
   - Coming up (meetings)
   - Birthdays
   - "Worth your time" (the old home cards, as rows in one card)

## Person

- **Header card**, centered:
  - big avatar (76)
  - name (24 bold), title, company (semibold)
  - tags: sector, "Close · 82", circle
  - action row: Message (primary, wider) plus Star, Remind and Circle as card2 buttons
- **Brief card:** small "Brief" label in text2, then the brief at 15pt.
- **Timeline card:** rows with title and detail on the left and the date on the right, separated by hairlines.
- **"Details, location and notes" row card**, which opens the rest: contact info, notes, location, ways in, and so on.

## People

- Title "People" with the count on the right.
- A white search field (radius 14).
- Filter pills: the active one in primary; the rest white. The last is a round filter button.
- One card holding the rows: avatar, name, detail, and on the right a small tag (Reply in amber tint, New job in blue tint) over the time.

## You

- **Profile card:** your photo or initials, name, network count and last refresh.
- **Share card button.**
- **Card "Your stuff":** Lists, Events, Trips, Saved searches, Birthdays.
- **Card "Data":** Import / Refresh connections, Back up notes.
- **Card:** Settings, Help / Contact support.
