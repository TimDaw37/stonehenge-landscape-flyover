"""Mesolithic car-park posts: dark blobs (post-pits A-C, 9580, tree hole) on a scan of Cleal et al. 1995 Fig. 24,
converted to OSGB with the figure's grid ticks (11.88 px per metre, tick E 412050 N 142350 at pixel 693, 2757).
Usage: python tools/carpark_fig24_points.py fig24_hi.png. The scan is not redistributed (copyright English Heritage).
"""
from PIL import Image; import numpy as np
from scipy import ndimage
im=np.array(Image.open(__import__('sys').argv[1] if len(__import__('sys').argv) > 1 else 'fig24_hi.png').convert('L')).astype(float)
def comps(x0,y0,x1,y1,th=140,minA=60):
  s=im[y0:y1,x0:x1]<th; lab,n=ndimage.label(s); out=[]
  for i in range(1,n+1):
    ys,xs=np.nonzero(lab==i)
    if len(xs)>=minA: out.append((round(xs.mean()+x0,1),round(ys.mean()+y0,1),len(xs),np.ptp(xs)+1,np.ptp(ys)+1))
  return out
def en(x,y): return (412050+(x-693)/11.88, 142350-(y-2757)/11.88)
for name,box in [('posts',(382,2262,1432,2770)),('9580',(2150,2650,2300,2800)),('9780',(2200,3400,2700,3700))]:
  print(name)
  for c in comps(*box): print(c, [round(v,1) for v in en(c[0],c[1])])
