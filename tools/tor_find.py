import os
EA_DTM = os.environ.get('EA_DTM_DIR', 'sources/ea1m')  # EA LIDAR Composite DTM 1 m GeoTIFFs (+ .tfw)
import tifffile, numpy as np
from PIL import Image
t=os.path.join(EA_DTM, 'SU14se_DTM_1m.tif')
tfw=[float(l) for l in open(t[:-4]+'.tfw')]
a=tifffile.imread(t).astype(np.float32)
x0,y0=tfw[4],tfw[5]; px=tfw[0]
print(a.shape,x0,y0,px)
E0,E1,N0,N1=417000,417800,142900,143500
c0=int((E0-x0)/px); c1=int((E1-x0)/px); r0=int((y0-N1)/px); r1=int((y0-N0)/px)
s=a[r0:r1,c0:c1]
from scipy.ndimage import uniform_filter
lrm=s-uniform_filter(s,15)
# bumps: local max of lrm
idx=np.argsort(lrm.ravel())[::-1]
seen=[]
for i in idx[:4000]:
  r,c=divmod(i,s.shape[1]);
  if any(abs(r-a_)<8 and abs(c-b_)<8 for a_,b_ in seen): continue
  seen.append((r,c))
  if len(seen)>=15: break
for r,c in seen:
  print('E %.1f N %.1f z %.2f lrm %.2f'%(x0+(c0+c+0.5)*px, y0-(r0+r+0.5)*px, s[r,c], lrm[r,c]))
# hillshade image
gy,gx=np.gradient(s)
hs=np.clip(0.5+(-gx+gy)*1.5,0,1)
im=np.stack([hs]*3,-1)
Image.fromarray((im*255).astype(np.uint8)).resize((1600,1200)).save('shots/_tor_hs.png')
Image.fromarray((np.clip(lrm*2+0.5,0,1)*255).astype(np.uint8)).resize((1600,1200)).save('shots/_tor_lrm.png')
