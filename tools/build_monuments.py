"""Build data/flyover/monuments.bin, monuments.js and till.bin, plus the scheduled-monument inventory.

Sources (downloaded to $FLYOVER_SOURCES/he, default sources/he; see tools/README.md):
  sm.json        Historic England NHLE Scheduled Monuments (FeatureServer layer 6), EPSG:27700, OGL
  aim_all.json   Historic England Aerial Investigation & Mapping, Detailed_Mapping (Stonehenge WHS NMP, 2002), OGL
  osm_osgb.json  OpenStreetMap River Till ways and stone points, converted to OSGB (ODbL)

monuments.bin 'FLYM' v2, little endian:
  header: magic, version, nv, ni, nd (domes), nr (outline rings), nrp (outline points), nchunks  (8 x uint32)
  chunk bounds: Uint32 [first vertex, first index] x (nchunks + 1)
  Int16 x,z [nv*2] in 0.25 m units (x = E - CE, z = -(N - CN))
  Uint8 category [nv]  (0 bank, 1 ditch, 2 field/linear, 3 henge bank, pad to 4)
  Uint16 idx [ni], relative to each chunk's first vertex (pad to 4)
  domes: Int16 x,z (0.25 m), Uint16 a,b (semi-axes, 0.05 m), Uint16 h (0.01 m), Int16 angle (0.01 deg)  [nd*6]
  outline rings: Uint32 count [nr], then Int16 x,z [nrp*2] (NHLE scheduled areas with no mapped earthwork)
till.bin 'FLYT' v1: magic, version, n, pad; Int16 x,z left/right pairs [n*4] in 0.25 m units.
"""
import json, math, os, re, struct, sys
import numpy as np
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
import mapbox_earcut as earcut

HE = os.path.join(os.environ.get('FLYOVER_SOURCES', 'sources'), 'he')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/flyover'
CE, CN = 412245.35, 142194.11
EXT = (406265, 136214, 418226, 148174)
BU_ORIGIN = (417475.55, 143546.19)
Q = 4.0  # quantisation: 0.25 m

def lx(e): return e - CE
def lz(n): return -(n - CN)

# ------------------------------------------------------------------ AIM selection
AIM = json.load(open(os.path.join(HE, 'aim_all.json')))
PREHIST_TYPES = ('BARROW', 'CURSUS', 'EMBANKED AVENUE', 'HENGE', 'RING DITCH', 'CAUSEWAYED', 'HENGIFORM', 'PIT CIRCLE',
                 'MORTUARY', 'HILLFORT', 'STANDING STONE', 'STONE CIRCLE', 'PALISADE')
GENERIC_TYPES = ('ENCLOSURE', 'FIELD SYSTEM', 'LINEAR EARTHWORK', 'LINEAR FEATURE', 'LYNCHET', 'DITCH', 'BANK (EARTHWORK)',
                 'SETTLEMENT', 'CROSS DYKE', 'BOUNDARY', 'MOUND')
PREHIST_PERIODS = ('NEOLITHIC', 'BRONZE AGE', 'IRON AGE', 'PREHISTORIC', 'ROMAN', 'MESOLITHIC')
MODERN = ('WATER MEADOW', 'RIFLE BUTTS', 'FIRING RANGE', 'SLIT TRENCH', 'MINEFIELD', 'WEAPONS PIT', 'PILLBOX', 'DEWPOND',
          'RIDGE AND FURROW', 'MILITARY', 'AIRFIELD', 'CHALK PIT', 'QUARRY')
SKIP_UID = {'219050'}  # Woodhenge: already modelled from Cunnington's plan (posts, bank and ditch)

def aim_class(a):
    t = (a.get('MONUMENT_TYPE') or '').upper(); p = (a.get('PERIOD') or '').upper(); layer = a.get('LAYER')
    if layer not in ('BANK', 'DITCH'): return None
    if 'NON ANTIQUITY' in t: return None
    if str(a.get('HE_UID')) in SKIP_UID: return None
    pre = any(k in t for k in PREHIST_TYPES)
    gen = any(k in t for k in GENERIC_TYPES)
    dated = any(k in p for k in PREHIST_PERIODS)
    if not pre:
        if not (gen and dated): return None
        if any(k in t for k in MODERN): return None
        if 'AVENUE (LANDSCAPE FEATURE)' in t: return None
    if any(k in t for k in ('FIELD SYSTEM', 'LYNCHET', 'LINEAR EARTHWORK', 'LINEAR FEATURE', 'BOUNDARY', 'CROSS DYKE')) and not pre:
        return 'field'
    if 'HENGE' in t and 'HENGIFORM' not in t and layer == 'BANK': return 'hengebank'
    return 'bank' if layer == 'BANK' else 'ditch'

def polys_from_rings(rings):
    """Esri rings: outer rings clockwise, holes anticlockwise."""
    outs, holes = [], []
    for r in rings:
        if len(r) < 4: continue
        a = 0.0
        for i in range(len(r) - 1): a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
        (outs if a < 0 else holes).append(r)
    polys = []
    for o in outs:
        po = Polygon(o)
        hs = [h for h in holes if po.contains(Point(h[0]))]
        polys.append(Polygon(o, hs))
    if not outs:  # tolerate odd orientation
        polys = [Polygon(r) for r in holes]
    return [p if p.is_valid else p.buffer(0) for p in polys]

def barrow_dome(t, poly):
    t = t.upper()
    if 'BARROW' not in t and 'MOUND' not in t: return None
    if len(poly.interiors) > 0: return None
    A = poly.area
    if A < 12 or A > 4000: return None
    xy = np.array(poly.exterior.coords)[:-1]
    c = xy.mean(0); d = xy - c
    w, v = np.linalg.eigh(np.cov(d.T))
    ax = v[:, 1]; proj1 = d @ ax; proj2 = d @ v[:, 0]
    a = (proj1.max() - proj1.min()) / 2; b = (proj2.max() - proj2.min()) / 2
    if b < 1.5: return None
    fill = A / (math.pi * a * b)
    if fill < 0.55: return None  # not a mound outline
    D = 2 * math.sqrt(A / math.pi)
    only = lambda *ks: all(any(k in part for k in ks) for part in t.split('\\') if 'BARROW' in part)
    if a / b > 1.8 or 'LONG BARROW' in t:
        h = 2.0
    elif only('POND'):
        return None
    elif only('DISC', 'SAUCER'):
        h = 0.4
    elif 'BELL' in t:
        h = min(3.0, max(1.0, 0.11 * D))
    else:
        h = min(2.5, max(0.5, 0.08 * D))
    cen = poly.centroid
    ang = math.degrees(math.atan2(ax[1], ax[0]))  # in E/N frame
    return (cen.x, cen.y, a, b, h, ang)

cat_code = {'bank': 0, 'ditch': 1, 'field': 2, 'hengebank': 3}

# ------------------------------------------------------------------ periods (see period_rules.md)
# 0 Mesolithic c. 9000-4000 BC, 1 Early Neolithic c. 4000-3000 BC, 2 Late Neolithic c. 3000-2500 BC,
# 3 Chalcolithic and Early Bronze Age c. 2500-1500 BC, 4 later (Middle Bronze Age onward) or undated.
PERIODS = [
    {'name': 'Mesolithic', 'dates': 'c. 9000 \u2013 4000 BC', 'to': 'c. 4000 BC'},
    {'name': 'Early Neolithic', 'dates': 'c. 4000 \u2013 3000 BC', 'to': 'c. 3000 BC'},
    {'name': 'Late Neolithic', 'dates': 'c. 3000 \u2013 2500 BC', 'to': 'c. 2500 BC'},
    {'name': 'Chalcolithic & Early Bronze Age', 'dates': 'c. 2500 \u2013 1500 BC', 'to': 'c. 1500 BC'},
    {'name': 'Later prehistory & undated', 'dates': 'after c. 1500 BC', 'to': 'today'},
]
EN_KEYS = ('LONG BARROW', 'OVAL BARROW', 'CAUSEWAYED ENCLOSURE', 'CURSUS', 'MORTUARY ENCLOSURE')
ROUND_KEYS = ('BOWL BARROW', 'BELL BARROW', 'DISC BARROW', 'POND BARROW', 'SAUCER BARROW', 'ROUND BARROW', 'RING DITCH', 'BARROW CEMETERY')
LN_KEYS = ('HENGE', 'HENGIFORM', 'PIT CIRCLE', 'STONE CIRCLE', 'STANDING STONE', 'TIMBER CIRCLE')
LATER_KEYS = ('FIELD SYSTEM', 'LYNCHET', 'LINEAR', 'BOUNDARY', 'CROSS DYKE', 'ENCLOSURE', 'SETTLEMENT', 'HILLFORT', 'SHAFT')
def period_of(text, per=''):
    """Monument type first (AIM MONUMENT_TYPE, several types joined by backslashes), then the AIM period field."""
    t = text.upper(); p = per.upper()
    if 'MESOLITHIC' in t or 'BLICK MEAD' in t: return 0
    if any(k in t for k in EN_KEYS): return 1
    if any(k in t for k in ROUND_KEYS): return 3          # the mound is what is drawn
    if any(k in t for k in LN_KEYS): return 2
    if 'PALISADE' in t and 'NEOLITHIC' in p: return 2
    if 'AVENUE' in t: return 3
    if 'BARROW' in t or 'MOUND' in t: return 3
    if any(k in t for k in LATER_KEYS): return 4
    if 'EARLY BRONZE AGE' in p or p == 'BRONZE AGE': return 3
    if p in ('NEOLITHIC', 'LATE NEOLITHIC'): return 2
    return 4
V, C, I = [], [], []
CHUNKS = [[0, 0]]
PENDING = []  # [first vertex, first index] of each chunk; indices are Uint16 relative to the chunk
def poly_base(nverts):
    if len(V) + nverts - CHUNKS[-1][0] > 65535: CHUNKS.append([len(V), len(I)])
    return len(V)
domes = []
drawn_polys = []  # for NHLE overlap test
stats = {}
for f in AIM:
    a = f['attributes']; cls = aim_class(a)
    if not cls: continue
    for poly in polys_from_rings(f['geometry']['rings']):
        if poly.is_empty: continue
        c = poly.representative_point()
        if not (EXT[0] < c.x < EXT[2] and EXT[1] < c.y < EXT[3]): continue
        if math.hypot(c.x - BU_ORIGIN[0], c.y - BU_ORIGIN[1]) < 120: continue  # Bulford: only the posts-3d data
        geoms = [poly] if poly.geom_type == 'Polygon' else list(poly.geoms)
        for g in geoms:
            drawn_polys.append(g)
            per = period_of(a['MONUMENT_TYPE'] or '', a.get('PERIOD') or '')
            if cls == 'field': per = 4
            dm = barrow_dome(a['MONUMENT_TYPE'] or '', g) if cls == 'bank' else None
            if dm:
                domes.append(dm + (per,)); stats['dome'] = stats.get('dome', 0) + 1
                continue
            tol, seg = (2.0, 40.0) if cls == 'field' else (0.5, 12.0)
            g2 = g.simplify(tol, preserve_topology=True)
            if g2.is_empty or g2.area < (120 if cls == 'field' else 1): continue
            g2 = g2.segmentize(seg)
            gs = [g2] if g2.geom_type == 'Polygon' else list(getattr(g2, 'geoms', []))
            for gg in gs:
                if gg.geom_type != 'Polygon' or gg.area < 1: continue
                PENDING.append((cls, gg, per)); stats[cls] = stats.get(cls, 0) + 1

# ------------------------------------------------------------------ extra features not in the AIM data
OSM = json.load(open(os.path.join(HE, 'osm_osgb.json')))
def ring_poly(e, n, r_in, r_out, seg=48):
    outer = [(e + r_out * math.cos(2 * math.pi * k / seg), n + r_out * math.sin(2 * math.pi * k / seg)) for k in range(seg)]
    inner = [(e + r_in * math.cos(2 * math.pi * k / seg), n + r_in * math.sin(2 * math.pi * k / seg)) for k in range(seg)]
    return Polygon(outer, [inner])
extra_polys = []
# Bluestonehenge / West Amesbury henge: not in the 2002 AIM mapping (found 2008). OSM point; ditch c. 23 m across (approximate).
BSH = (414216.9, 141382.0)
extra_polys.append(('ditch', ring_poly(BSH[0], BSH[1], 10.0, 12.5), 2))
PENDING.extend(extra_polys)
# Emit polygons grouped in 1.5 km cells, one chunk (mesh) per cell, so the page can frustum-cull them.
CELL = 1500.0
def cell_of(g):
    c = g.representative_point(); return (int((c.x - EXT[0]) // CELL), int((c.y - EXT[1]) // CELL))
PENDING.sort(key=lambda it: cell_of(it[1]))
last_cell = None
for cls, g, per in PENDING:
    cc = cell_of(g)
    rings = [np.array(g.exterior.coords)[:-1]] + [np.array(r.coords)[:-1] for r in g.interiors]
    verts = np.concatenate(rings); ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    tri = earcut.triangulate_float64(verts, ends).reshape(-1, 3)
    if last_cell is not None and cc != last_cell and len(V) > CHUNKS[-1][0]: CHUNKS.append([len(V), len(I)])
    last_cell = cc
    base = poly_base(len(verts))
    for (e, n) in verts: V.append((round(lx(e) * Q), round(lz(n) * Q))); C.append(cat_code[cls] | (per << 4))
    for t3 in tri:
        p0, p1, p2 = verts[t3[0]], verts[t3[1]], verts[t3[2]]
        # face up in three.js (x east, z south): the E/N cross product equals the three.js normal's y
        cr = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
        I.extend((base + t3[0], base + t3[1], base + t3[2]) if cr > 0 else (base + t3[0], base + t3[2], base + t3[1]))

# ------------------------------------------------------------------ NHLE inventory and labels
SM = json.load(open(os.path.join(HE, 'sm.json')))['features']
aim_union = unary_union([p.buffer(0) for p in drawn_polys]) if drawn_polys else None
CEMS = [
    (r'New King Barrows', 'New King Barrows'), (r'Old King Barrow', 'Old King Barrows'),
    (r'The Cursus round barrow cemetery|round barrow cemetery 400m north of the eastern end of The Cursus', 'Cursus Barrows'),
    (r'Normanton Down|Normanton Gorse|Bush Barrow', 'Normanton Down Barrows'),
    (r'Winterbourne Stoke crossroads', 'Winterbourne Stoke Crossroads Barrows'),
    (r'Lake Down|Lake Barrow Group', 'Lake Down Barrows'), (r'Wilsford round barrow|Wilsford Down', 'Wilsford Barrows'),
    (r'Durrington Down', 'Durrington Down Barrows'), (r'Rollestone Field', 'Rollestone Field Barrows'),
    (r'Winterbourne Stoke East|Fore Down', 'Winterbourne Stoke East Barrows'), (r'Winterbourne Stoke Down|Airman', 'Winterbourne Stoke Down Barrows'),
    (r'Stonehenge Down', 'Stonehenge Down Barrows'), (r'Coneybury', 'Coneybury Hill Barrows'),
    (r"Earl's Farm Down|Newton Barrows", "Earl's Farm Down Barrows"), (r'Lesser Cursus', 'Lesser Cursus Barrows'),
    (r'Fargo', 'Fargo Barrows'), (r'south of Bulford', 'Bulford Barrows'), (r'Countess Farm', 'Countess Farm Barrows'),
    (r'The Packway', 'Packway Barrows'), (r'Greenland', 'Greenland Farm Barrows'), (r'Luxenborough', 'Luxenborough Barrows'),
]
NOTABLE = {
    1009132: ('Greater Cursus', 'cursus'), 1010901: ('Lesser Cursus', 'cursus'), 1009133: ('Durrington Walls', 'henge'),
    1009593: ("Robin Hood's Ball", 'enclosure'), 1012126: ("Vespasian's Camp", 'enclosure'), 1012376: ('Coneybury henge', 'henge'),
    1005677: ('Ogbury Camp', 'enclosure'), 1005686: ('Stapleford Castle', 'enclosure'), 1015948: ('Ratfyn Barrow', 'barrow'),
    1010048: ('Gallows Barrow', 'barrow'), 1012395: ('Monarch of the Plain', 'barrow'), 1012375: ('King Barrow', 'barrow'),
    1010052: ('Knighton Long Barrow', 'barrow'), 1009697: ('Barrow Clump', 'barrow'), 1021349: ('Henge, Longbarrow Cross Roads', 'henge'),
    1012402: ('Hengiform, Fargo Plantation', 'henge'), 1010833: ('Wilsford Shaft', 'barrow'), 1009130: ('Long barrow (Woodhenge)', 'barrow'),
    1009461: ('Orcheston Down field system', 'field'), 1005609: ('Heale Hill barrows', 'barrow'), 1009653: ('Milston Farm enclosure', 'enclosure'),
    1449706: ('Bulford henges', 'henge'), 1010140: ('Stonehenge and the Avenue', 'henge'), 1011841: ('Long barrow, Winterbourne Stoke', 'barrow'),
    1010830: ('Long barrow, Wilsford Down', 'barrow'), 1015020: ('Winterbourne Stoke East barrows and enclosure', 'barrow'),
    1009618: ('Bush Barrow', 'barrow'), 1010863: ('Lake barrows and North Kite', 'barrow'),
}
SKIP = {
    1010021: 'Medieval settlement and moat', 1015221: 'Post-medieval bridge', 1010879: 'Deserted medieval village (its barrow is drawn from the aerial mapping if mapped)',
    1005608: 'Cultivation terraces, probably medieval strip lynchets', 1015220: 'Lynchets, probably medieval strip lynchets',
}
def short_type(name):
    n = name.lower()
    if 'long barrow' in n: return 'Long barrow'
    m = re.match(r'(two|three|four|five|six|seven|eight|nine|ten|eighteen|\d+) ', n)
    if m or 'barrows' in n or 'cemetery' in n: return 'Barrow group'
    for k in ('bell', 'disc', 'pond', 'saucer', 'bowl', 'round'):
        if k + ' barrow' in n: return k.capitalize() + ' barrow'
    if 'henge' in n or 'hengi' in n: return 'Henge'
    if 'linear boundary' in n: return 'Linear boundary'
    if 'enclosure' in n or 'camp' in n or 'castle' in n: return 'Enclosure'
    if 'field system' in n or 'landscape' in n: return 'Field system'
    return 'Monument'
NOTABLE_PERIOD = {  # named monuments: 1 Early Neolithic, 2 Late Neolithic, 3 Chalcolithic/EBA, 4 later
    1009132: 1, 1010901: 1, 1009593: 1, 1010052: 1, 1009130: 1, 1011841: 1, 1010830: 1,
    1009133: 2, 1012376: 2, 1021349: 2, 1012402: 2, 1449706: 2, 1010140: 2,
    1015948: 3, 1010048: 3, 1012395: 3, 1012375: 3, 1009697: 3, 1005609: 3, 1015020: 3, 1009618: 3, 1010863: 3,
    1012126: 4, 1005677: 4, 1005686: 4, 1010833: 4, 1009461: 4, 1009653: 4,
}
TYPE_PERIOD = {'Long barrow': 1, 'Henge': 2, 'Barrow group': 3, 'Bowl barrow': 3, 'Bell barrow': 3, 'Disc barrow': 3, 'Pond barrow': 3,
               'Saucer barrow': 3, 'Round barrow': 3, 'Linear boundary': 4, 'Enclosure': 4, 'Field system': 4}
def nhle_period(le, typ, name):
    if le in NOTABLE_PERIOD: return NOTABLE_PERIOD[le]
    if typ in TYPE_PERIOD: return TYPE_PERIOD[typ]
    return period_of(name)
inv, labels, cem_pts = [], [], {}
for f in SM:
    a = f['attributes']; le = a['ListEntry']; name = a['Name']
    polys = polys_from_rings(f['geometry']['rings'])
    shape = unary_union(polys)
    rp = shape.representative_point()
    inside = EXT[0] < rp.x < EXT[2] and EXT[1] < rp.y < EXT[3]
    mapped = aim_union is not None and shape.intersects(aim_union)
    typ = short_type(name)
    row = {'le': le, 'name': name, 'type': typ, 'en': [round(rp.x), round(rp.y)], 'mapped': mapped}
    if not inside:
        row.update(inc=False, why='Outside the 12 km extent (polygon only clips it)')
    elif le in SKIP:
        row.update(inc=False, why=SKIP[le])
    else:
        row.update(inc=True, why=('Drawn from Historic England aerial mapping' if mapped else 'No mapped earthwork: scheduled area outline drawn'))
        row['p'] = nhle_period(le, typ, name)
        if le in NOTABLE:
            labels.append({'t': NOTABLE[le][0], 'en': row['en'], 'k': 'major', 'p': row['p']})
        else:
            labels.append({'t': typ, 'en': row['en'], 'k': 'minor', 'p': row['p']})
        for rx, cname in CEMS:
            if re.search(rx, name, re.I):
                cem_pts.setdefault(cname, []).append(shape.centroid.coords[0]); row['group'] = cname; break
        if le == 1449706:
            row['why'] = 'Drawn as the two ring ditches from the Bulford posts-3d data (BULFORD.henges), not the scheduled area'
        elif not mapped:
            row['outline'] = [(row['p'], list(map(lambda p: (round(lx(p[0]) * Q), round(lz(p[1]) * Q)), p.exterior.coords))) for p in polys]
    inv.append(row)
for cname, pts in cem_pts.items():
    if len(pts) < 2 and cname not in ('New King Barrows',): continue
    e = sum(p[0] for p in pts) / len(pts); n = sum(p[1] for p in pts) / len(pts)
    labels.append({'t': cname, 'en': [round(e), round(n)], 'k': 'group', 'p': 3})
# Named points that are not scheduled monuments (or are inside larger ones).
labels.append({'t': 'The Avenue', 'en': [412880, 142520], 'k': 'major', 'p': 3})
labels.append({'t': 'Avenue elbow', 'en': [412940, 142560], 'k': 'minor', 'p': 3})
labels.append({'t': 'Bluestonehenge (approx.)', 'en': list(BSH), 'k': 'major', 'p': 2})
labels.append({'t': 'Blick Mead', 'en': [414915.8, 142035.0], 'k': 'major', 'p': 0})
# Mesolithic posts in the old Stonehenge car park (Vatcher and Vatcher 1973; Allen in Cleal et al. 1995, 43-56).
# Posts A-C: centres of the white marker discs set in the car-park tarmac over the three post-pits, measured on
# Esri World Imagery (Wayback release 2014-02-20, before the car park was grassed over). Cleal et al. 1995 Fig 24
# (OS grid ticks, registered at 11.9 px/m) puts them within 1.0 m of these; the HE record (Monument 219856) gives
# the markers as SU 12054237, 12064237, 12084237 (10 m references). Tree hole and pit 9580 (Wessex Archaeology
# 1988-9): Fig 24 only, about +/-3 m. Posts about 0.75 m thick (post pipes); their height is not known.
MESO_POSTS = [
    {'t': 'Post A', 'en': [412058.1, 142372.6], 'fig': [412058.1, 142373.6], 'date': 'HAR-455 9130+-180 BP, 8820-7730 cal BC'},
    {'t': 'Post B', 'en': [412068.1, 142372.3], 'fig': [412067.8, 142373.1], 'date': 'HAR-456 8090+-140 BP, 7480-6590 cal BC'},
    {'t': 'Post C', 'en': [412080.2, 142373.7], 'fig': [412080.1, 142374.0], 'date': 'undated'},
    {'t': 'Post-pit 9580', 'en': [412178.4, 142352.2], 'fig': [412178.4, 142352.2], 'date': 'GU-5109 8880+-80 BP, OxA-4219 8520+-80 BP, OxA-4220 8400+-100 BP (fills)'},
]
MESO_TREEHOLE = {'t': 'Tree hole (undated)', 'en': [412044.7, 142372.7], 'd': 2.5}
MESO_POST_D, MESO_POST_H = 0.75, 6.0  # height conjectural
labels.append({'t': 'Mesolithic posts, c. 8800-6600 BC (post heights conjectural)', 'en': [412069.0, 142380.0], 'k': 'major', 'p': 0})
for mp in MESO_POSTS: labels.append({'t': mp['t'], 'en': mp['en'], 'k': 'detail', 'p': 0})
labels.append({'t': MESO_TREEHOLE['t'], 'en': MESO_TREEHOLE['en'], 'k': 'detail', 'p': 0})
labels.append({'t': 'Larkhill causewayed enclosure', 'en': [414084.1, 144274.7], 'k': 'minor', 'p': 1})
labels = [l for l in labels if not (l['t'] in ('Bulford henges',))]  # Bulford already has its site label
stones = []
for p in OSM['points']:
    if p['name'] == 'Cuckoo Stone':
        stones.append({'t': 'Cuckoo Stone', 'en': p['en'], 'len': 2.1, 'wid': 1.6, 'th': 0.9, 'ang': 45, 'src': 'OpenStreetMap', 'state': 'recumbent', 'p': 2})
# Tor Stone: the stone marker in Harding et al. 2025 (PPS 90, Figs 8-11), registered to EA 1 m lidar
# (tools/tor_register2.py), gives E 417359.5 N 143179.0 (four figures agree within 2 m; about +/-10 m). The
# DTM there is 107.87 m OD against the paper's 107.86 m (109.51 m observer height less 1.65 m). 3.7 m away is a
# 5.6 m square STRUCTURE in the Historic England aerial mapping, inside the ring ditch of round barrow
# HE_UID 1358757; its centre is used as the stone's position. Recumbent today ('now recumbent', Harding et al. 2025).
stones.append({'t': 'Tor Stone', 'en': [417356.3, 143177.0], 'len': 2.8, 'wid': 1.5, 'th': 1.0, 'ang': 0, 'src': 'HE aerial mapping STRUCTURE in HE_UID 1358757; Harding et al. 2025 figs registered to lidar', 'state': 'recumbent', 'p': 2})

outline_items = [r for row in inv if row.get('inc') and row.get('outline') for r in row['outline']]
outlines = [r for _, r in outline_items]; outline_per = [p for p, _ in outline_items]

# ------------------------------------------------------------------ write monuments.bin
V = np.array(V, np.int16).reshape(-1, 2); Cc = np.array(C, np.uint8); I = np.array(I, np.int64)
nrp = sum(len(r) for r in outlines)
bounds = CHUNKS + [[len(V), len(I)]]
I16 = np.empty(len(I), np.uint16)
for k in range(len(CHUNKS)):
    v0, i0 = bounds[k]; v1, i1 = bounds[k + 1]
    rel = I[i0:i1] - v0; assert rel.min() >= 0 and rel.max() < 65536; I16[i0:i1] = rel
hdr = struct.pack('<4s7I', b'FLYM', 3, len(V), len(I), len(domes), len(outlines), nrp, len(CHUNKS))
body = hdr + np.array(bounds, np.uint32).tobytes() + V.tobytes() + Cc.tobytes() + b'\0' * ((-len(Cc)) % 4) + I16.tobytes() + b'\0' * ((-len(I16) * 2) % 4)
for (e, n, a_, b_, h, ang, _p) in domes:
    body += struct.pack('<hhHHHh', round(lx(e) * Q), round(lz(n) * Q), min(65535, round(a_ * 20)), min(65535, round(b_ * 20)), round(h * 100), round(ang * 100))
body += bytes([d[6] for d in domes]); body += b'\0' * ((-len(body)) % 4)
body += np.array([len(r) for r in outlines], np.uint32).tobytes()
body += bytes(outline_per); body += b'\0' * ((-len(body)) % 4)
body += np.array([p for r in outlines for p in r], np.int16).tobytes()
open(os.path.join(OUT, 'monuments.bin'), 'wb').write(body)

# ------------------------------------------------------------------ River Till ribbon
ways = OSM['ways']  # the upper Till (above Winterbourne Stoke) is tagged as a stream
segs = [list(map(tuple, w['pts'])) for w in ways]
chain = segs.pop(0)
while segs:
    best = None
    for k, s in enumerate(segs):
        for rev in (False, True):
            ss = s[::-1] if rev else s
            for at_end in (True, False):
                d = math.dist(chain[-1], ss[0]) if at_end else math.dist(chain[0], ss[-1])
                if best is None or d < best[0]: best = (d, k, ss, at_end)
    d, k, ss, at_end = best; segs.pop(k)
    if d > 200: continue
    chain = chain + ss[1:] if at_end else ss[:-1] + chain
line = LineString(chain).simplify(2.0)
L = line.length; step = 24.0
pts = [line.interpolate(s) for s in np.arange(0, L, step)] + [Point(line.coords[-1])]
pts = [(p.x, p.y) for p in pts]
# Chaikin smoothing, 2 passes
for _ in range(2):
    sm = [pts[0]]
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        sm += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
    pts = sm + [pts[-1]]
W2 = 20.0  # half-width: 40 m ribbon (the Avon ribbon is 78 m)
LR = []
for i, (x, y) in enumerate(pts):
    a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
    dx, dy = b[0] - a[0], b[1] - a[1]; l = math.hypot(dx, dy) or 1
    nx, ny = -dy / l, dx / l
    le_, ln_ = x + nx * W2, y + ny * W2; re_, rn_ = x - nx * W2, y - ny * W2
    if not (EXT[0] - 50 < x < EXT[2] + 50 and EXT[1] - 50 < y < EXT[3] + 50): LR.append(None); continue
    LR.append((round(lx(le_) * Q), round(lz(ln_) * Q), round(lx(re_) * Q), round(lz(rn_) * Q)))
runs, cur = [], []
for p in LR:
    if p is None:
        if len(cur) > 1: runs.append(cur)
        cur = []
    else: cur.append(p)
if len(cur) > 1: runs.append(cur)
tb = struct.pack('<4s3I', b'FLYT', 1, len(runs), 0)
for r in runs: tb += struct.pack('<I', len(r)) + np.array(r, np.int16).tobytes()
open(os.path.join(OUT, 'till.bin'), 'wb').write(tb)

# ------------------------------------------------------------------ monuments.js
meta = {
    'credits': 'Monuments: contains Historic England data \u00a9 Historic England 2026, OGL (scheduled monuments; aerial mapping). River Till, Cuckoo Stone, Blick Mead, Bluestonehenge \u00a9 OpenStreetMap contributors, ODbL. Mesolithic posts: Cleal et al. 1995 Fig 24 and the car-park marker discs.',
    'periods': PERIODS,
    'posts': [{'t': mp['t'], 'x': round(lx(mp['en'][0]), 2), 'z': round(lz(mp['en'][1]), 2), 'd': MESO_POST_D, 'h': MESO_POST_H, 'p': 0} for mp in MESO_POSTS],
    'treeholes': [{'t': MESO_TREEHOLE['t'], 'x': round(lx(MESO_TREEHOLE['en'][0]), 2), 'z': round(lz(MESO_TREEHOLE['en'][1]), 2), 'd': MESO_TREEHOLE['d'], 'p': 0}],
    'labels': [{'t': l['t'], 'x': round(lx(l['en'][0]), 1), 'z': round(lz(l['en'][1]), 1), 'k': l['k'], 'p': l['p']} for l in labels],
    'stones': [dict(s, x=round(lx(s['en'][0]), 2), z=round(lz(s['en'][1]), 2)) for s in stones],
}
open(os.path.join(OUT, 'monuments.js'), 'w').write('window.FLYOVER_MONUMENTS = ' + json.dumps(meta, separators=(',', ':'), ensure_ascii=False) + ';\n')

# ------------------------------------------------------------------ inventory
rows = sorted(inv, key=lambda r: (not r['inc'], r['name']))
md = ['# Scheduled monuments in the flyover extent', '',
      'Source: Historic England, National Heritage List for England, Scheduled Monuments layer (Open Data Hub feature service, EPSG:27700), '
      'queried 27 Sep 2026 for E 406265-418225, N 136214-148174. Contains Historic England data \u00a9 Historic England 2026, OGL.', '',
      'Drawn geometry comes from the Historic England Aerial Investigation & Mapping data (Stonehenge World Heritage Site NMP project, 2002) wherever the scheduled area contains mapped banks or ditches; otherwise the scheduled area outline is drawn.', '',
      f"Totals: {len(inv)} entries, {sum(r['inc'] for r in inv)} included, {sum(not r['inc'] for r in inv)} left out.", '',
      '| List entry | Name | Type | Included | Why |', '|---|---|---|---|---|']
for r in rows:
    md.append(f"| [{r['le']}](https://historicengland.org.uk/listing/the-list/list-entry/{r['le']}) | {r['name']} | {r['type']}{(' (' + r['group'] + ')') if r.get('group') else ''} | {'yes' if r['inc'] else 'no'} | {r['why']} |")
md += ['', '## Not scheduled, added from other sources', '',
       '| Feature | Source | Drawn as |', '|---|---|---|',
       '| Cuckoo Stone | OpenStreetMap node (Q23073287) | Recumbent sarsen block 2.1 x 1.6 x 0.9 m |',
       '| Tor Stone, Bulford | E 417356.3 N 143177.0 (SU 17356 43177): centre of the 5.6 m STRUCTURE square in the HE aerial mapping inside round barrow ring ditch HE_UID 1358757, 3.7 m from the stone marker in Harding et al. 2025 (PPS 90) Figs 8-11 registered to EA 1 m lidar (E 417359.5 N 143179.0, about 10 m) | Recumbent sarsen block 2.8 x 1.5 x 1.0 m (recumbent today) |',
       '| Bluestonehenge (West Amesbury henge) | OpenStreetMap point | Ring ditch about 23 m across; approximate |',
       '| Blick Mead | OpenStreetMap point | Label only |',
       '| Mesolithic posts A, B, C (old car park) | Marker discs in the car-park tarmac, measured on Esri World Imagery 2014: A 412058.1 142372.6, B 412068.1 142372.3, C 412080.2 142373.7; Cleal et al. 1995 Fig 24 agrees within 1.0 m; about +/-2 m | Posts 0.75 m thick, 6 m high (height conjectural) |',
       '| Post-pit 9580 (1988-9) | Cleal et al. 1995 Fig 24: 412178.4 142352.2, about +/-3 m | Post 0.75 m thick, 6 m high (conjectural) |',
       '| Tree hole (1966, undated) | Cleal et al. 1995 Fig 24: 412044.7 142372.7, about +/-3 m | Dark 2.5 m disc |',
       '| Larkhill causewayed enclosure | OpenStreetMap point (Build 4 pin) | Label only |',
       '| The Avenue beyond the scheduled area | Historic England aerial mapping (EMBANKED AVENUE, HE_UID 858883) | Two ditches and banks to West Amesbury |']
open(os.path.join(OUT, '..', '..', 'scheduled_monuments_inventory.md'), 'w').write('\n'.join(md) + '\n')
import collections; print('by cat', collections.Counter((Cc & 15).tolist()));print('verts', len(V), 'tris', len(I) // 3, 'domes', len(domes), 'outlines', len(outlines), 'bytes', len(body), stats)
print('till runs', [len(r) for r in runs], 'bytes', len(tb), 'length km', round(L / 1000, 1))
import collections as _c
print('periods: fill verts', _c.Counter((Cc >> 4).tolist()), 'domes', _c.Counter(d[6] for d in domes), 'outlines', _c.Counter(outline_per), 'labels', _c.Counter(l['p'] for l in labels))
print('Monument-type labels', [(r['le'], r['name'], r.get('p')) for r in inv if r['type'] == 'Monument'])
print('labels', len(labels), 'included', sum(r['inc'] for r in inv), 'of', len(inv), 'unmapped', [r['name'][:50] for r in inv if r.get('inc') and not r['mapped']])
