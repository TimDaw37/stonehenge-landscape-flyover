# Period layers: rules used by the flyover

The Period slider shows monuments cumulatively: moving it to a period shows that period and everything earlier.
Each feature carries one period number, written into monuments.bin (FLYM v3) by tools/build_monuments.py.
Features fade in or out over about half a second. The caption gives the date range.

| # | Slider label | Date range used | What it includes |
|---|---|---|---|
| 0 | Mesolithic | c. 9000–4000 BC | the Stonehenge car-park posts A, B, C and post-pit 9580 (c. 8800–6600 cal BC), the undated tree hole beside them, Blick Mead (label) |
| 1 | Early Neolithic | c. 4000–3000 BC | long and oval barrows, causewayed enclosures (Robin Hood's Ball, Larkhill), the Greater and Lesser Cursus, mortuary enclosures |
| 2 | Late Neolithic | c. 3000–2500 BC | henges and hengiform monuments, pit and post circles, stone and timber circles, standing stones: Stonehenge (whole monument), Woodhenge, Durrington Walls, Coneybury, Bluestonehenge, Bulford henges, Cuckoo Stone, Tor Stone |
| 3 | Chalcolithic / Early Bronze Age | c. 2500–1500 BC | round barrows of all forms and ring ditches, barrow cemeteries, the Stonehenge Avenue |
| 4 | Later (Middle Bronze Age onwards) | after c. 1500 BC | field systems, lynchets, linear ditches and boundaries, undated enclosures, settlements, hillforts (Vespasian's Camp, Ogbury), Wilsford Shaft |

## How a feature gets its period (first rule that matches wins)

1. Scheduled monuments (NHLE): a list of named entries is set by hand (e.g. the Cursuses, Robin Hood's Ball and long barrows are 1; Durrington, Coneybury, the henges, Bulford and Stonehenge are 2; named barrow groups are 3; Vespasian's Camp, Ogbury, Stapleford Castle, Wilsford Shaft, the Orcheston field system and the Milston Farm enclosure are 4). Other entries go by monument type as in the rules below.
2. Aerial mapping (AIM) records go by the MONUMENT_TYPE words, checked in this order:
   - Mesolithic → 0
   - long barrow, oval barrow, causewayed enclosure, cursus, mortuary enclosure → 1
   - round barrow, bowl/bell/disc/saucer/pond barrow, ring ditch → 3 (checked before henge, so a barrow over a hengiform monument counts as a barrow)
   - henge, hengiform, pit circle, stone circle, timber circle, standing stone; palisade with a Neolithic period → 2
   - avenue → 3
   - any other barrow or mound → 3
   - field system, lynchet, linear feature, boundary, enclosure, settlement, hillfort, shaft → 4
   - otherwise use the AIM PERIOD field (Neolithic or Late Neolithic → 2, Early Bronze Age or plain Bronze Age → 3, anything else or blank → 4)
3. Field-system fills are always 4.
4. Hand-placed features: the car-park Mesolithic posts and tree hole are 0; Stonehenge stones, Woodhenge posts, Bulford rings, the Cuckoo Stone and the Tor Stone are 2. Labels carry their own period (Avenue and Avenue elbow 3, Bluestonehenge 2, Blick Mead 0, Larkhill causewayed enclosure 1, cemetery group labels 3).

## Uncertain assignments (these are simplifications)

- Stonehenge is shown as one Late Neolithic monument. Its ditch dates from c. 3000 BC and the sarsens from c. 2500 BC; later rearrangements are not split out.
- The Avenue (c. 2400–2200 BC) is put in the Chalcolithic/EBA layer, not the Late Neolithic.
- Undated ring ditches are all treated as Early Bronze Age barrows. Some may be earlier or later.
- Records with several types (e.g. a barrow over a hengiform monument or timber circle) take the barrow's period (EBA), so the earlier part is hidden until layer 3.
- The Wilsford Shaft (Middle Bronze Age, c. 1500–1300 BC) goes in the Later layer.
- Undated enclosures and field systems go in the Later layer. Some may be prehistoric.
- The car-park tree hole is undated; it is shown with the posts (Mesolithic) because it lies on their line. Post heights (6 m) are a guess.
- The North Kite enclosure, inside the Lake barrows scheduling, takes the barrows' EBA period.
- Counts in the current build: fill vertices {Later 66,303, EBA 23,615, E Neo 2,205, L Neo 1,661}; barrow domes {EBA 338, E Neo 23}; outlines {EBA 36, Later 3, L Neo 2}; labels {EBA 243, E Neo 18, Later 14, Meso 7, L Neo 6}; Mesolithic posts 4 and tree hole 1.
