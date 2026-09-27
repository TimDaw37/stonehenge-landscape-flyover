"""Mesolithic car-park posts: fetch a 3x3 block of Esri World Imagery Wayback tiles around the old Stonehenge
car park, to read the white marker discs over post-pits A, B and C (release 10 = 2014-02-20, before the car park
was grassed over). Usage: python tools/carpark_wayback_tiles.py <release> <zoom>  -> wb_<release>_<zoom>.png.
The disc centres were then measured on the mosaic; results are in build_monuments.py (MESO_POSTS).
Imagery (c) Esri and its providers; used here only to take measurements.
"""
import math, urllib.request, io, sys
from PIL import Image
rel=sys.argv[1]; z=int(sys.argv[2]); lat,lon=51.18047,-1.82872
n=2**z; xt=(lon+180)/360*n; yt=(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n
x0,y0=int(xt)-1,int(yt)-1
out=Image.new('RGB',(768,768))
for dx in range(3):
  for dy in range(3):
    u=f'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{rel}/{z}/{y0+dy}/{x0+dx}'
    try: out.paste(Image.open(io.BytesIO(urllib.request.urlopen(u,timeout=20).read())).convert('RGB'),(dx*256,dy*256))
    except Exception as e: print(e)
out.save(f'wb_{rel}_{z}.png'); print(x0,y0,xt,yt)
