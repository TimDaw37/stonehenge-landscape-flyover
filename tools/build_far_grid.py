"""Build data/flyover/far.bin: wide, coarse ground for the skyline beyond the 12 km EA DTM sheet.

Source: OS Terrain 50 (ASCII grid, 50 m), Open Government Licence v3.0.
  Download the GB 'ASCII Grid and GML (Grid)' zip from the OS Data Hub
  (https://api.os.uk/downloads/v1/products/Terrain50/downloads), then:
  python tools/build_far_grid.py terr50_gb.zip data/flyover/far.bin
Extent E 396000-436000, N 126000-162000 (40 x 36 km, 20 km+ around Bulford to the east and north-east),
resampled to 100 m by block mean. Same 'FLYG' layout as build_flyover_data.py, version 2 with flag bit 0 set:
no RGB block (the page colours it from the wide ground's mean colour).
"""
import io, struct, sys, zipfile
import numpy as np

CE, CN, ORIGIN_OD = 412245.35, 142194.11, 102.588
E0, E1, N0, N1, STEP = 396000, 436000, 126000, 162000, 100

def tiles_needed():
    for e in range(E0 // 10000 * 10000, E1, 10000):
        for n in range(N0 // 10000 * 10000, N1, 10000):
            sq = 'st' if e < 400000 else 'su'
            yield sq, (e // 10000) % 10, (n // 10000) % 10, e, n

def read_asc(txt):
    lines = txt.splitlines()
    hdr = {}
    k = 0
    while lines[k].split()[0].lower() in ('ncols', 'nrows', 'xllcorner', 'yllcorner', 'cellsize', 'nodata_value'):
        a, b = lines[k].split()[:2]; hdr[a.lower()] = float(b); k += 1
    z = np.array(' '.join(lines[k:]).split(), np.float64).reshape(int(hdr['nrows']), int(hdr['ncols']))
    return hdr, z

def main(zpath, out):
    big = zipfile.ZipFile(zpath)
    names = big.namelist()
    W, H = (E1 - E0) // 50 + 200, (N1 - N0) // 50 + 200
    ex0, ny1 = E0 // 10000 * 10000, (N1 + 9999) // 10000 * 10000
    mosaic = np.full(((ny1 - N0 // 10000 * 10000) // 50, (E1 + 9999) // 10000 * 10000 // 50 - ex0 // 50), np.nan)
    for sq, de, dn, e, n in tiles_needed():
        tag = '%s%d%d_' % (sq, de, dn)
        nm = [x for x in names if x.split('/')[-1].lower().startswith(tag) and x.endswith('.zip')]
        if not nm: print('missing', tag); continue
        inner = zipfile.ZipFile(io.BytesIO(big.read(nm[0])))
        asc = [x for x in inner.namelist() if x.lower().endswith('.asc')][0]
        hdr, z = read_asc(inner.read(asc).decode())
        assert hdr['xllcorner'] == e and hdr['yllcorner'] == n and hdr['cellsize'] == 50
        r0 = (ny1 - (n + 10000)) // 50; c0 = (e - ex0) // 50
        mosaic[r0:r0 + 200, c0:c0 + 200] = z
    # Cell centres of the 50 m grid: E = ex0 + 25 + 50c, N = ny1 - 25 - 50r. Block-mean 2x2 onto 100 m nodes.
    es = np.arange(E0, E1 + 1, STEP); ns = np.arange(N1, N0 - 1, -STEP)  # row 0 = north
    c = ((es - 50 - ex0) / 50).astype(int); r = ((ny1 - ns - 50) / 50).astype(int)
    blk = sum(mosaic[np.ix_(r + dr, c + dc)] for dr in (0, 1) for dc in (0, 1)) / 4
    assert not np.isnan(blk).any(), 'gap in the tiles'
    y = blk - ORIGIN_OD
    nx, ny = len(es), len(ns)
    x0, z0 = float(E0 - CE), float(CN - N1)
    hmin = float(np.floor(y.min() * 100) / 100); hscale = 0.01
    q = np.round((y - hmin) / hscale); assert q.max() < 65535
    hdr = struct.pack('<4s3I6f6I', b'FLYG', 2, nx, ny, x0, z0, float(STEP), float(STEP), hmin, hscale, 1, 0, 0, 0, 0, 0)
    body = hdr + q.astype('<u2').tobytes()
    body += b'\0' * ((-len(body)) % 4)
    open(out, 'wb').write(body)
    print(out, nx, ny, 'E %d-%d N %d-%d' % (E0, E1, N0, N1), 'OD %.1f-%.1f' % (blk.min(), blk.max()), len(body), 'bytes')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
