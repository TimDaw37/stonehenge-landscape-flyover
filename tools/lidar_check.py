import os
EA_DTM = os.environ.get('EA_DTM_DIR', 'sources/ea1m')  # EA LIDAR Composite DTM 1 m GeoTIFFs (+ .tfw)
import json, math, os, numpy as np, tifffile, sys
HE = os.path.join(os.environ.get("FLYOVER_SOURCES", "sources"), "he")
from PIL import Image, ImageDraw
sys.path.insert(0, 'tools')
T = {}
def tile(name):
    if name not in T:
        a = tifffile.imread(os.path.join(EA_DTM, f'{name}_DTM_1m.tif')).astype(np.float32)
        T[name] = a
    return T[name]
def dtm(e0, n0, e1, n1):
    out = np.full((n1 - n0, e1 - e0), np.nan, np.float32)
    for name, te, tn in (('SU14sw', 410000, 140000), ('SU14se', 415000, 140000), ('SU04se', 405000, 140000), ('SU13nw', 410000, 135000), ('SU13ne', 415000, 135000)):
        a = tile(name)  # row 0 = north edge (tn + 5000)
        ea, eb = max(e0, te), min(e1, te + 5000); na, nb = max(n0, tn), min(n1, tn + 5000)
        if ea >= eb or na >= nb: continue
        rows = slice(tn + 5000 - nb, tn + 5000 - na); cols = slice(ea - te, eb - te)
        out[n1 - nb:n1 - na, ea - e0:eb - e0] = a[rows, cols]
    return out
def hillshade(z):
    z = np.where(z < -100, np.nan, z)
    gy, gx = np.gradient(z)
    az, alt = math.radians(315), math.radians(35)
    slope = np.arctan(np.hypot(gx, gy) * 3); aspect = np.arctan2(-gx, gy)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.nan_to_num(np.clip(hs, 0, 1) * 255).astype(np.uint8)
from shapely.geometry import Polygon, Point
AIM = json.load(open(os.path.join(os.environ.get('FLYOVER_SOURCES', 'sources'), 'he', 'aim_all.json')))
exec(open('tools/build_monuments.py').read().split('# ------------------------------------------------------------------ AIM selection')[1].split('cat_code =')[0])
def draw(name, e0, n0, e1, n1, scale=1):
    hs = hillshade(dtm(e0, n0, e1, n1))
    im = Image.fromarray(hs).convert('RGB')
    if scale != 1: im = im.resize((im.width * scale, im.height * scale))
    d = ImageDraw.Draw(im)
    P = lambda e, n: ((e - e0) * scale, (n1 - n) * scale)
    for f in AIM:
        a = f['attributes']; cls = aim_class(a)
        if not cls: continue
        col = {'bank': (255, 200, 40), 'hengebank': (255, 120, 40), 'ditch': (40, 220, 255), 'field': (160, 255, 120)}[cls]
        for r in f['geometry']['rings']:
            xs = [p[0] for p in r]; ys = [p[1] for p in r]
            if max(xs) < e0 or min(xs) > e1 or max(ys) < n0 or min(ys) > n1: continue
            d.line([P(*p) for p in r], fill=col, width=1)
    os.makedirs('shots', exist_ok=True); im.save(f'shots/lidar_{name}.png'); print(name, im.size)
draw('cursus_west', 410850, 142750, 411650, 143300)
draw('avenue_elbow', 412250, 142150, 413250, 142750)
draw('durrington', 414700, 143400, 415350, 144000)
draw('king_barrows', 413250, 141900, 413750, 142500)
draw('normanton', 411300, 141050, 412200, 141550)
