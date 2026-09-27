# Stonehenge landscape flyover

A browser flight over the Stonehenge, Woodhenge and Bulford landscape: 12 km of Environment Agency lidar ground, the Rivers Avon and Till, the scheduled monuments and aerial-mapped earthworks, the Stonehenge stones, Woodhenge posts, the Bulford rings, the Cuckoo Stone and Tor Stone, and the Mesolithic car-park posts. A live sky shows the sun, moon and stars for any date, now or in 2500 BC.

**Open it:** https://timdaw37.github.io/stonehenge-landscape-flyover/

It is a single static page (three.js + astronomy-engine, no build step). To run it locally, serve the folder with any static web server, for example `python -m http.server`, and open `index.html`. Opening the file straight from disk does not work because the page uses a web worker and fetches data files.

## Controls

- **W / S** or **↑ / ↓**: forward and back. **A / D**: sideways. **← / →**: turn.
- **E / R**: up. **Q / F**: down. **Shift**: faster.
- **Drag** to look, **mouse wheel** moves toward the pointer, **double-click** flies there.
- **L**: labels on/off. **P**: plan view (straight down), with the alignment rays.
- On a phone or tablet: a thumb stick (bottom left) and up/down buttons (bottom right).
- The panel (top left) has: Go to Stonehenge / Woodhenge / Bulford, a guided tour, speed, lowest height above ground, labels, monuments, the period slider, sky (sunrise, sunset, moonrise, moonset; gleam, half orb or full orb; stars), epoch (modern or 2500 BC), date and time.

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

## Mesolithic car-park posts

Posts A, B and C and post-pit 9580 are placed from Cleal et al. 1995 Fig. 24, checked against the white marker discs in the old car park (Esri World Imagery Wayback, February 2014) and the Historic England record. Figure and discs agree within 1 m; positions are good to about ±2 m for A–C and ±3 m for 9580 and the tree hole. The posts are drawn 0.75 m across; their 6 m height is conjectural. Dates: A 8820–7730 cal BC (HAR-455), B 7480–6590 cal BC (HAR-456), C undated; 9580 fills 8880±80, 8520±80 and 8400±100 BP.

## Astronomy method

- Sun and moon positions come from [astronomy-engine](https://github.com/cosinekitty/astronomy) (apparent place, with the observer at the camera's own latitude, longitude and height), with standard refraction.
- Rise and set are timed where the chosen limb (gleam, half or full orb) meets the local skyline, computed from the terrain model around the observer. Where the terrain runs out too close in the event's direction, the measured Woodhenge skyline is used and the readout says so.
- Solstices and equinoxes come from astronomy-engine `Seasons()`. Lunar standstills use the mean lunar node for the chosen epoch (major: node at 0°, minor: 180°) and the month of extreme declination nearest to it.
- Azimuths are given against true north and against OS grid north (grid convergence applied). Stars are J2000 places precessed to the epoch; proper motion is ignored.

## Data sources and licences

- **Terrain:** Environment Agency LIDAR Composite DTM, © Environment Agency, Open Government Licence v3.0. Resampled and packed for the web.
- **Monuments:** contains Historic England data © Historic England 2026, Open Government Licence v3.0: National Heritage List for England (scheduled monuments) and the Stonehenge World Heritage Site aerial investigation and mapping.
- **Rivers, Cuckoo Stone, Blick Mead, Bluestonehenge:** © OpenStreetMap contributors, Open Database Licence (ODbL).
- **Tor Stone and Cuckoo Stone (size, recumbent state):** Harding, P., Nash, D., Ciborowski, J. et al. 2025. Earliest movement of sarsen into the Stonehenge landscape: new insights from geochemical and visibility analysis of the Cuckoo Stone and Tor Stone. *Proceedings of the Prehistoric Society* 90, 229–251. https://doi.org/10.1017/ppr.2024.13
- **Mesolithic car-park posts:** Vatcher, F. de M. and Vatcher, H.L. 1973. Excavation of three post-holes in Stonehenge car park. *Wiltshire Archaeological and Natural History Magazine* 68, 57–63; Allen, M.J. in Cleal, R.M.J., Walker, K.E. and Montague, R. 1995. *Stonehenge in its Landscape: Twentieth-century excavations* (English Heritage), Fig. 24 and the radiocarbon dates.
- **Woodhenge posts:** read from Maud Cunnington's plan (1929), set on the concrete markers.
- **Stonehenge stones:** the pose compilation from [stonehenge-block-3d](https://github.com/TimDaw37/stonehenge-block-3d).
- **Libraries:** three.js (MIT), astronomy-engine (MIT); their licence headers are kept in `vendor/`.

## Licence

Tim Daw's code, data compilation and text are CC BY-SA 4.0; third-party data keep their own licences. See [LICENSE](LICENSE).

This is a modelling and exploration tool, not a finished reconstruction. Positions and dates are those of the cited sources, with the uncertainties noted. Inclusion of a site does not imply public access.
