"""Build compact binary ground for the flyover page (data/flyover/*.bin).

Usage: python tools/build_flyover_data.py <stonehenge-block-3d checkout> data/flyover
Inputs from the stonehenge-block-3d repository (EA LIDAR Composite DTM, already resampled there):
  data/terrain_horizon.js  'horizon' (12 km wide ground) and 'near' (Stonehenge sheet) position/colour grids
  woodhenge/avon.bin       Woodhenge/Bulford 10 m sheet and the Avon ribbon
Outputs under data/flyover/:
  coarse.bin  220x220 wide ground (EA DTM 12 km, ~54.6 m)
  near.bin    200x200 Stonehenge sheet (~2.5 m)
  detail.bin  600x600 Woodhenge/Bulford sheet (10 m)
  river.bin   Avon ribbon
Grid file 'FLYG': 16 x 4-byte header
  magic, version, nx, ny, x0, z0, dx, dz, hmin, hscale, 0...
  then Uint16 heights (row 0 = north, columns east), then Uint8 RGB, padded to 4.
  y = hmin + h * hscale, in the shared frame (y = OD - 102.588).
River 'FLYR': magic, version, nv, ni, Float32 xyz[nv], Uint16/Uint32 idx[ni].
"""
import json, struct, sys, os
import numpy as np

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

def write_grid(path, P, C, nx, ny):
    P = P.reshape(ny, nx, 3)
    x0, z0 = float(P[0, 0, 0]), float(P[0, 0, 2])
    dx = float((P[0, -1, 0] - P[0, 0, 0]) / (nx - 1))
    dz = float((P[-1, 0, 2] - P[0, 0, 2]) / (ny - 1))
    # check regular
    ex = np.abs(P[:, :, 0] - (x0 + dx * np.arange(nx)[None, :])).max()
    ez = np.abs(P[:, :, 2] - (z0 + dz * np.arange(ny)[:, None])).max()
    assert ex < 0.05 and ez < 0.05, (path, ex, ez)
    y = P[:, :, 1].astype(np.float64)
    hmin = float(np.floor(y.min() * 100) / 100)
    hscale = 0.01
    q = np.round((y - hmin) / hscale)
    assert q.max() < 65535
    q = q.astype('<u2')
    err = np.abs(hmin + q * hscale - y).max()
    rgb = np.asarray(C).reshape(-1, 3)
    if rgb.dtype != np.uint8:
        rgb = np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)
    hdr = struct.pack('<4s3I6f6I', b'FLYG', 1, nx, ny, x0, z0, dx, dz, hmin, hscale, 0, 0, 0, 0, 0, 0)
    body = hdr + q.tobytes() + rgb.tobytes()
    body += b'\0' * ((-len(body)) % 4)
    open(path, 'wb').write(body)
    print(path, nx, ny, 'x0 %.2f z0 %.2f dx %.4f dz %.4f' % (x0, z0, dx, dz), 'maxerr %.4f m' % err, len(body), 'bytes')
    return dict(nx=nx, ny=ny, x0=x0, z0=z0, dx=dx, dz=dz)

s = open(os.path.join(src, 'data/terrain_horizon.js'), encoding='utf-8').read()
T = json.loads(s[s.index('{'):s.rindex('}') + 1])
H = T['horizon']; N = T['near']
write_grid(os.path.join(out, 'coarse.bin'), np.array(H['positions'], np.float64), np.array(H['colors'], np.float64), 220, 220)
write_grid(os.path.join(out, 'near.bin'), np.array(N['positions'], np.float64), np.array(N['colors'], np.float64), 200, 200)

b = open(os.path.join(src, 'woodhenge/avon.bin'), 'rb').read()
magic, ver, nv, ni, nrv, nri, _ = struct.unpack('<7I', b[:28])
assert magic == 0x56414857
o = 28
P = np.frombuffer(b, np.float32, nv * 3, o).astype(np.float64); o += nv * 12
C = np.frombuffer(b, np.uint8, nv * 3, o); o += nv * 3
o += ni * 4
RP = np.frombuffer(b, np.float32, nrv * 3, o).copy(); o += nrv * 12
RI = np.frombuffer(b, np.uint32, nri, o).copy()
write_grid(os.path.join(out, 'detail.bin'), P, C, 600, 600)
idx = RI.astype('<u2') if nrv < 65536 else RI.astype('<u4')
body = struct.pack('<4s3I', b'FLYR', 1, nrv, nri) + RP.astype('<f4').tobytes() + idx.tobytes()
body += b'\0' * ((-len(body)) % 4)
open(os.path.join(out, 'river.bin'), 'wb').write(body)
print('river.bin', nrv, nri, len(body))
