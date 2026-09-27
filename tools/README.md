# Rebuilding the flyover data

The page reads only the files in `data/flyover/`. These scripts rebuild them from open sources. Run them from the
repository root. You need Python 3.10+ with numpy; build_monuments.py also needs shapely and mapbox_earcut; the
lidar and Tor Stone checks need tifffile, scipy and opencv-python; osm_to_osgb.mjs needs Node 18+.

Source files go under `sources/` (or set `FLYOVER_SOURCES`); EA 1 m DTM tiles go under `sources/ea1m` (or set
`EA_DTM_DIR`). None of the source downloads are committed.

| Output | Script | Source |
|---|---|---|
| `coarse.bin` (12 km, ~55 m), `near.bin` (Stonehenge, ~2.5 m), `detail.bin` (Woodhenge/Bulford, 10 m), `river.bin` (Avon ribbon) | `build_flyover_data.py <stonehenge-block-3d checkout> data/flyover` | EA LIDAR Composite DTM (OGL v3), as already resampled in the stonehenge-block-3d repository: `data/terrain_horizon.js` and `woodhenge/avon.bin` |
| `far.bin` (40 x 36 km at 100 m, for the skyline beyond the lidar, 18 km or more east and north-east of Bulford) | `build_far_grid.py terr50_gb.zip data/flyover/far.bin` | OS Terrain 50, ASCII grid, GB zip from the OS Data Hub (OGL v3): https://api.os.uk/downloads/v1/products/Terrain50/downloads |
| `far_rivers.bin` (river centrelines over the far ground: Avon, Till, Wylye, Nadder, Bourne, Ebble) | `OPEN_RIVERS_GPKG=oprvrs_gb.gpkg build_far_rivers.py` | OS Open Rivers (OGL), GeoPackage from the OS Data Hub |
| `monuments.bin`, `monuments.js`, `till.bin`, plus `scheduled_monuments_inventory.md` | `build_monuments.py data/flyover` | Historic England (OGL v3): NHLE Scheduled Monuments (ArcGIS FeatureServer, layer 6, EPSG:27700) as `sources/he/sm.json`; Aerial Investigation and Mapping, Detailed Mapping (Stonehenge WHS NMP) as `sources/he/aim_all.json`. OpenStreetMap (ODbL): River Till ways and the Cuckoo Stone, Blick Mead and Bluestonehenge points, converted with `osm_to_osgb.mjs` to `sources/he/osm_osgb.json` |

The HE layers were queried for the box E 406265–418226, N 136214–148174 in EPSG:27700 as GeoJSON; the exact query
URLs were not recorded.

Grid files ('FLYG'): 64-byte header (magic, version, nx, ny, x0, z0, dx, dz, hmin, hscale, flags), Uint16 heights
(row 0 = north), then Uint8 RGB unless flag bit 0 is set (far.bin has no colour; the page tints it). Heights are
in the page frame: x = E − 412245.35, z = 142194.11 − N, y = OD − 102.588.

## Positions measured by hand

- **Mesolithic car-park posts A–C, post-pit 9580, tree hole:** `carpark_wayback_tiles.py` fetches Esri World Imagery Wayback tiles (release 2014-02-20) of the old car park so that the marker-disc centres can be measured. `carpark_fig24_points.py` reads the same features off a scan of Cleal et al. 1995 Fig. 24. The scan is not redistributed. The results, and how well they agree, are written into `build_monuments.py` (`MESO_POSTS`).
- **Tor Stone:** `tor_find.py`, `tor_register.py` and `tor_register2.py` register the figures in Harding et al. 2025 (PPS 90, Figs 8–11) to EA 1 m lidar tiles SU14se/SU14sw by SIFT features on hillshades. The figure images are not redistributed. The result (E 417359.5 N 143179.0, about ±10 m) and the chosen position (the centre of the HE aerial-mapping STRUCTURE 3.7 m away) are in `build_monuments.py`.

## Checks

- `lidar_check.py`: draws EA 1 m DTM hillshades with the aerial-mapped earthworks on top (`shots/lidar_*.png`) to check registration.
- `river_check.py`: checks the Avon ribbon (`river.bin`) sits above the detail and wide ground (both detail LODs).

## Built at run time

The rivers are draped on the ground in `data/flyover/terrain_worker.js` (`riverMesh`), not here. The sheets are
meshed there too. The period of each monument follows `period_rules.md`.
