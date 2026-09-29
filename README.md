# Stonehenge landscape flyover

A browser flight over the Stonehenge, Woodhenge and Bulford landscape: 12 km of Environment Agency lidar ground with Ordnance Survey Terrain 50 out to the horizon, the Rivers Avon and Till, the scheduled monuments and aerial-mapped earthworks, the Stonehenge stones, Woodhenge posts, the Bulford rings, the Cuckoo Stone and Tor Stone, and the Mesolithic car-park posts. A live sky shows the sun, moon and stars for any date, now or in 2500 BC.

**Open it:** https://timdaw37.github.io/stonehenge-landscape-flyover/

It is a single static page (three.js + astronomy-engine, no build step). To run it locally, serve the folder with any static web server, for example `python -m http.server`, and open `index.html`. Opening the file straight from disk does not work because the page uses a web worker and fetches data files.

## System requirements

- **Browser:** a 2023-or-later desktop or mobile browser with JavaScript modules and WebGL: Chrome or Edge 111+, Firefox 115+ (including Firefox ESR 115, the last version for Windows 7 and 8.1), or Safari 16.4+ (iPhone/iPad iOS 16.4+). Tested: current Chrome and Firefox, and Firefox ESR 115. Safari and older Chromium builds (such as Chrome/Edge 109 on Windows 8.1) are expected to work but have not been tested.
- **Graphics:** WebGL 2 preferred (WebGL 1 may work). Hardware graphics acceleration should be on. On software graphics or weak integrated GPUs the page switches to low-graphics mode by itself; you can also force it with `?quality=low` (or back with `?quality=high`).
- **Memory:** about 140 MB of graphics memory in full quality at 1080p (about 36 MB in low-graphics mode); 4 GB of system RAM or more is recommended.
- **Download:** about 2.6 MB on the first visit (5.1 MB unpacked; 26 files, all served from this site: no CDN, web fonts, map tiles or tracking). The browser caches it for later visits.
- **If it will not start:** the page stops after 45 seconds without progress (longer while data is still arriving) and says what went wrong, with **Try again** and **Try low-graphics** buttons and technical details to send with a bug report.

## Controls

- **W / S** or **↑ / ↓**: forward and back. **A / D**: sideways. **← / →**: turn.
- **E / R**: up. **Q / F**: down. **Shift**: faster.
- **Left-drag** grabs the ground and moves the landscape as a block, map style: the point under the pointer stays under it (height and heading are kept; near the horizon the move is capped so it doesn't fling away).
- **Right-drag** looks around (turn and tilt). On a trackpad: **Ctrl + drag** or **Alt + drag**.
- **Middle-drag** or **Shift + right-drag** orbits around the grabbed point.
- **Mouse wheel** moves toward the pointer, **double-click** flies there.
- **L**: labels on/off. **P**: plan view (straight down), with the alignment rays. In plan view, drag pans and right-drag turns the heading.
- On a phone or tablet: one finger moves the landscape, pinch zooms, twist turns, and a two-finger drag up or down tilts.
- **Flight pad** (bottom right): hold the ring to fly (forward, back, sideways), drag the ball to look, ▲/▼ to climb or drop, » for fast. It can be hidden; `?ui=classic` brings back the old layout.
- Keys go to a focused slider, list or box (arrows move the slider, not the camera); click the view to fly with the keys again.
- The panels can be page-zoomed on a phone; pinch and twist on the 3D view stay the flyover's own.
- The panel (top left) has: Go to Stonehenge / Woodhenge / Bulford, a guided tour, speed, labels, monuments, the timber monuments section, the period slider, sky (sunrise, sunset, moonrise, moonset; gleam, half orb or full orb; stars), epoch (modern or 2500 BC), date and time.

## Alignment check

Choose a site (Stonehenge centre, Woodhenge centre, Bulford, the Cuckoo Stone or the Tor Stone), an event (midsummer, midwinter or March equinox sunrise or sunset; major or minor lunar standstill moonrise or moonset, north or south), an epoch (modern, 2500 BC or a custom year) and a limb (first gleam, half orb, full orb), then **Go**. The view drops to eye height (1.6 m) at the site, faces the event and sets the sky to the moment the chosen part of the disc meets the local skyline. The panel gives the true and grid azimuth, the altitude, which skyline was used and how far the event is from any site axis within 20° (Stonehenge solstice axis, the Woodhenge axes, the Bulford posts line).

## Plan view and alignment rays

**P** or the Plan view button looks straight down. **Event** draws one alignment ray (with a faint reverse ray labelled with the event it points to); **Fan** draws all 14 sun and moon events in seven colours with a legend. Rays start from the view centre, or from the alignment site after Go ("Use the view centre" switches back). They use the same horizon-aware azimuths as the alignment check and update with the view centre, the date and the epoch.

## Periods

The Period slider is cumulative: a period shows that period and everything earlier.

| Step | Period | Dates used | Includes |
|---|---|---|---|
| 0 | Mesolithic | c. 9000–4000 BC | Stonehenge car-park posts A, B, C and post-pit 9580; the undated tree hole beside them; Blick Mead (label) |
| 1 | Early Neolithic | c. 4000–3000 BC | long and oval barrows, causewayed enclosures, the Greater and Lesser Cursus, mortuary enclosures |
| 2 | Late Neolithic | c. 3000–2500 BC | henges, pit and post circles, stone and timber circles, standing stones: Stonehenge, Woodhenge, Durrington Walls, Coneybury, Bluestonehenge, Bulford, Cuckoo Stone, Tor Stone |
| 3 | Chalcolithic / Early Bronze Age | c. 2500–1500 BC | round barrows and ring ditches, barrow cemeteries, the Stonehenge Avenue |
| 4 | Later | after c. 1500 BC | field systems, lynchets, linear ditches, undated enclosures, settlements, hillforts, the Wilsford Shaft |

Rules, in order: named scheduled monuments are set by hand; aerial-mapping records go by their monument type (Mesolithic; long barrow, cursus etc.; round barrows and ring ditches before henges, so a barrow over a hengiform counts as a barrow; henges, circles and standing stones; avenue; other barrows; field systems and later types), otherwise by the record's period field. These are simplifications: Stonehenge is shown as one Late Neolithic monument, the Avenue is put with the Early Bronze Age, undated ring ditches are all treated as Early Bronze Age barrows, and undated enclosures and field systems go in the Later layer.

## Flight limits

You can fly anywhere over the 40 x 36 km ground plus a 3 km margin, up to 30 km above sea level, high enough to see the whole ground at once. The wheel, the pad, pinch and plan view all keep to these limits. Flying (keys and pad) speeds up with height above the ground. From above 1.5 km every river also shows as a thin line, because the ribbons are narrower than a pixel from high up.

## Timber monuments

A collapsible panel section with two show/hide buttons.

- **Woodhenge posts**: the 156 posts of the Woodhenge page (`woodhenge/posts.js`, from Maud Cunnington's 1929 plan, seated on the concrete markers), 0.64 m thick. Ring checkboxes (A to F, with counts and colours) and one height slider (1 to 12 m, 7.5 m by default, as that page). The heights are conjectural: no posts survive. Each post stands on the lidar ground at its own spot.
- **Bulford posts**: every feature from [bulford-posts-3d](https://timdaw37.github.io/bulford-posts-3d/) (`data/flyover/bulford_features.js`, 39 features). Each is labelled with its number, kind and ground height (m OD). The two posts (8647 and 9019) are drawn 1.6 m above ground, labelled **(Conjecture)**: the post-pits are 0.8 m deep (the PAST 113 average for the pair, measuring surface not stated), taken as a third of a 2.4 m post. Hole numbers are off by default. Tick 'Hole numbers' to show them up close or always. Crowded labels stack upward, and any with no room are hidden until the view comes closer. (The 'Post height boost' of that page is kept in the code but hidden in this viewer.) Pit positions are digitised from the PAST 113 plan (Harding, Leivers & Silva 2026), not the Wessex GNSS survey.

## Mesolithic car-park posts

Posts A, B and C and post-pit 9580 are placed from Cleal et al. 1995 Fig. 24, checked against the white marker discs in the old car park (Esri World Imagery Wayback, February 2014) and the Historic England record. Figure and discs agree within 1 m; positions are good to about ±2 m for A–C and ±3 m for 9580 and the tree hole. The posts are drawn 0.75 m across; their 6 m height is conjectural. Dates: A 8820–7730 cal BC (HAR-455), B 7480–6590 cal BC (HAR-456), C undated; 9580 fills 8880±80, 8520±80 and 8400±100 BP.

## Astronomy method

- Sun and moon positions come from [astronomy-engine](https://github.com/cosinekitty/astronomy) (apparent place, with the observer at the camera's own latitude, longitude and height), with standard refraction.
- Rise and set are timed where the chosen limb (gleam, half or full orb) meets the local skyline, traced over the terrain out to 20 km from the observer (eye 1.6 m, earth curvature and terrestrial refraction k = 0.13). The skyline is kept for each eye point, so changing the date, limb or epoch only re-times it; it is traced again when finer ground arrives.
- The lidar covers about 12 km; OS Terrain 50 (100 m) carries the ground to 18 km or more beyond Bulford to the east and north-east, so every monument has at least 16 km of skyline in every direction. Cutting the ground off at 2.5 km would lower the skyline by up to 1.3° in rise and set directions; at 10 km by up to 0.2°. So where the ground runs out less than 10 km away within ±3° of the event, the readout says the skyline may be too low (near Woodhenge the measured Woodhenge skyline is used instead). With the wider ground this no longer happens at any monument.
- The plan-view rays are computed in a web worker (same searches as the alignment check), so the 14-event fan does not hold up the page.
- Solstices and equinoxes come from astronomy-engine's sun-longitude search (as its `Seasons()`, but with dates built so that years 0–99 are not read as 1900–1999). Years are astronomical (0 = 1 BC, −2499 = 2500 BC), proleptic Gregorian; 'Modern' is the current year. Lunar standstills use the mean lunar node for the chosen epoch (major: node at 0°, minor: 180°) and the month of extreme declination nearest to it.
- Azimuths are given against true north and against OS grid north (grid convergence applied). Stars are J2000 places precessed to the epoch; proper motion is ignored.

## Data sources and licences

- **Terrain:** Environment Agency LIDAR Composite DTM, © Environment Agency, Open Government Licence v3.0. Beyond about 6 km: OS Terrain 50, contains OS data © Crown copyright and database right 2026, Open Government Licence v3.0. Resampled and packed for the web; see [tools/README.md](tools/README.md) to rebuild the data files.
- **Monuments:** contains Historic England data © Historic England 2026, Open Government Licence v3.0: National Heritage List for England (scheduled monuments) and the Stonehenge World Heritage Site aerial investigation and mapping.
- **Rivers beyond the lidar** (Avon, Till, Wylye, Nadder, Bourne, Ebble over the 40 x 36 km ground): OS Open Rivers, contains OS data © Crown copyright and database right 2026, Open Government Licence v3.0.
- **Rivers within the lidar, Cuckoo Stone, Blick Mead, Bluestonehenge:** © OpenStreetMap contributors, Open Database Licence (ODbL).
- **Tor Stone and Cuckoo Stone (size, recumbent state):** Harding, P., Nash, D., Ciborowski, J. et al. 2025. Earliest movement of sarsen into the Stonehenge landscape: new insights from geochemical and visibility analysis of the Cuckoo Stone and Tor Stone. *Proceedings of the Prehistoric Society* 90, 229–251. https://doi.org/10.1017/ppr.2024.13
- **Mesolithic car-park posts:** Vatcher, F. de M. and Vatcher, H.L. 1973. Excavation of three post-holes in Stonehenge car park. *Wiltshire Archaeological and Natural History Magazine* 68, 57–63; Allen, M.J. in Cleal, R.M.J., Walker, K.E. and Montague, R. 1995. *Stonehenge in its Landscape: Twentieth-century excavations* (English Heritage), Fig. 24 and the radiocarbon dates.
- **Woodhenge posts:** read from Maud Cunnington's plan (Cunnington, M.E. 1929. *Woodhenge*), set on the concrete markers. Post heights are conjectural.
- **Bulford pits and posts:** positions digitised from the published plan in Harding, P., Leivers, M. and Silva, F. 2026. A newly discovered solstitial post alignment in the Stonehenge landscape at Bulford. *PAST* 113 (Summer 2026), 2–5. The Prehistoric Society. https://www.prehistoricsociety.org/publications/past/113 — via [bulford-posts-3d](https://timdaw37.github.io/bulford-posts-3d/). Post heights are conjectural.
- **Stonehenge stones:** the pose compilation from [stonehenge-block-3d](https://github.com/TimDaw37/stonehenge-block-3d).
- **Libraries:** three.js r160 (MIT, the official minified build in `data/flyover/three.module.min.js`), astronomy-engine (MIT, `vendor/`); their licence headers are kept.

## Licence

Tim Daw's code, data compilation and text are CC BY-SA 4.0; third-party data keep their own licences. See [LICENSE](LICENSE).

This is a modelling and exploration tool, not a finished reconstruction. Positions and dates are those of the cited sources, with the uncertainties noted. Inclusion of a site does not imply public access.
