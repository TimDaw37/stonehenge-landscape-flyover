"""Build data/flyover/far_rivers.bin: river centrelines over the whole far ground (OS Open Rivers, OGL).

Source: OS Open Rivers GeoPackage (oprvrs_gb.gpkg, download from the OS Data Hub; path in OPEN_RIVERS_GPKG).
Keeps the named rivers in NAMES inside the far.bin extent (E 396000-436000, N 126000-162000), joins the
links into polylines and simplifies them to about 25 m. The page drapes them on the far ground as ribbons
beyond the lidar sheets, and draws all of them as thin lines when viewed from high up.

far_rivers.bin 'FLYW' v1: magic, version, nLines, pad; per line: Uint8 river index, Uint8 pad, Uint16 n,
then n x (Float32 x, Float32 z) in local metres (x = E - 412245.35, z = -(N - 142194.11)).
"""
import os, sqlite3, struct, math, json
GPKG = os.environ.get('OPEN_RIVERS_GPKG', 'oprvrs_gb.gpkg')
OUT = os.environ.get('FLYOVER_OUT', os.path.join(os.path.dirname(__file__), '..', 'data', 'flyover'))
CE, CN = 412245.35, 142194.11
E0, E1, N0, N1 = 396000, 436000, 126000, 162000
NAMES = ['River Avon', 'River Till', 'River Wylye', 'River Nadder', 'River Bourne', 'River Ebble']

def wkb_lines(blob):
    flags = blob[3]; env = (flags >> 1) & 7
    off = 8 + [0, 32, 48, 48, 64][env]
    b = blob[off:]; le = b[0] == 1; e = '<' if le else '>'
    t = struct.unpack(e + 'I', b[1:5])[0]
    dim = 3 if (t // 1000 == 1 or t & 0x80000000) else 2
    base = t % 1000 if t < 0x80000000 else t & 0xffff
    def ls(p):
        n = struct.unpack(e + 'I', b[p:p + 4])[0]; p += 4
        pts = [struct.unpack(e + 'd' * dim, b[p + k * 8 * dim:p + (k + 1) * 8 * dim])[:2] for k in range(n)]
        return pts, p + n * 8 * dim
    if base == 2: return [ls(5)[0]]
    if base == 5:
        n = struct.unpack(e + 'I', b[5:9])[0]; p = 9; out = []
        for _ in range(n): pts, p = ls(p + 5); out.append(pts)
        return out
    return []

c = sqlite3.connect(GPKG)
links = {}
for name, blob, s, t, fict in c.execute("select watercourse_name, geometry, start_node, end_node, fictitious from watercourse_link where watercourse_name in (%s)" % ','.join('?' * len(NAMES)), NAMES):
    for pts in wkb_lines(blob):
        if not any(E0 - 2000 <= x <= E1 + 2000 and N0 - 2000 <= y <= N1 + 2000 for x, y in pts): continue
        links.setdefault(name, []).append((s, t, pts))

def join(ls):
    # chain links end-to-start into long polylines
    by_start = {}
    for i, (s, t, p) in enumerate(ls): by_start.setdefault(s, []).append(i)
    ends = {t for s, t, p in ls}
    used = set(); out = []
    order = sorted(range(len(ls)), key=lambda i: ls[i][0] in ends)
    for i in order:
        if i in used: continue
        used.add(i); s, t, pts = ls[i]; line = list(pts)
        while True:
            nxt = [j for j in by_start.get(t, []) if j not in used]
            if not nxt: break
            j = nxt[0]; used.add(j); t = ls[j][1]; line += ls[j][2][1:]
        out.append(line)
    return out

def simplify(pts, tol=12.0):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-9
    dmax, k = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / L
        if d > dmax: dmax, k = d, i
    if dmax <= tol: return [a, b]
    return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)

def clip(line):
    # keep the runs inside the far extent (plus 200 m), split where the line leaves it
    inside = lambda p: E0 - 200 <= p[0] <= E1 + 200 and N0 - 200 <= p[1] <= N1 + 200
    runs, cur = [], []
    for p in line:
        if inside(p): cur.append(p)
        elif cur: runs.append(cur); cur = []
    if cur: runs.append(cur)
    return [r for r in runs if len(r) >= 2]

body = b''; nl = 0; stats = {}
for ri, name in enumerate(NAMES):
    for line in join(links.get(name, [])):
        for run in clip(simplify(line)):
            for k in range(0, len(run) - 1, 60000):
                seg = run[k:k + 60001]
                body += struct.pack('<BBH', ri, 0, len(seg)) + b''.join(struct.pack('<ff', x - CE, -(y - CN)) for x, y in seg)
                nl += 1
                stats[name] = stats.get(name, 0) + sum(math.hypot(seg[i + 1][0] - seg[i][0], seg[i + 1][1] - seg[i][1]) for i in range(len(seg) - 1))
data = struct.pack('<4sIII', b'FLYW', 1, nl, 0) + body
open(os.path.join(OUT, 'far_rivers.bin'), 'wb').write(data)
print('lines', nl, 'bytes', len(data), json.dumps({k: round(v / 1000, 1) for k, v in stats.items()}))
