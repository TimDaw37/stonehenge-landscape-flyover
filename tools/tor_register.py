import os
EA_DTM = os.environ.get('EA_DTM_DIR', 'sources/ea1m')  # EA LIDAR Composite DTM 1 m GeoTIFFs (+ .tfw)
import tifffile, numpy as np, cv2
D=EA_DTM+'/'
R=2.0  # m/px of reference
E0,E1,N0,N1=412000,420000,140000,145000
W=int((E1-E0)/R); H=int((N1-N0)/R)
ref=np.full((H,W),np.nan,np.float32)
for t in ['SU14se','SU14sw']:
  f=D+t+'_DTM_1m.tif'; tfw=[float(l) for l in open(f[:-4]+'.tfw')] if __import__('os').path.exists(f[:-4]+'.tfw') else None
  a=tifffile.imread(f).astype(np.float32); a[a<-100]=np.nan
  if tfw is None:
    x0=410000 if t.endswith('sw') else 415000; y0=145000
  else: x0=tfw[4]-0.5; y0=tfw[5]+0.5
  b=a.reshape(a.shape[0]//2,2,a.shape[1]//2,2).mean((1,3))
  c0=int((x0-E0)/R); r0=int((N1-y0)/R)
  cs=max(0,-c0); c0c=max(0,c0)
  wv=min(W-c0c,b.shape[1]-cs)
  ref[r0:r0+b.shape[0], c0c:c0c+wv]=b[:, cs:cs+wv]
  print(t,x0,y0)
ref=np.nan_to_num(ref,nan=np.nanmean(ref))
gy,gx=np.gradient(ref,R)
# light from NW (315 az, 45 alt) analytical hillshade
az=np.radians(315); alt=np.radians(45)
slope=np.arctan(np.hypot(gx,gy)); aspect=np.arctan2(-gx,gy)
hs=np.sin(alt)*np.cos(slope)+np.cos(alt)*np.sin(slope)*np.cos(az-aspect)
hs8=np.clip(hs*255,0,255).astype(np.uint8)
cv2.imwrite('shots/_ref_hs.png',hs8)
img=cv2.imread(os.path.join(os.environ.get('FLYOVER_SOURCES', 'sources'), 'he', 'torv-001.jpg'),0)
# mask legend/labels roughly
sift=cv2.SIFT_create(8000)
k1,d1=sift.detectAndCompute(img,None); k2,d2=sift.detectAndCompute(hs8,None)
m=cv2.BFMatcher().knnMatch(d1,d2,k=2)
good=[a for a,b in m if a.distance<0.8*b.distance]
print('kp',len(k1),len(k2),'good',len(good))
p1=np.float32([k1[g.queryIdx].pt for g in good]); p2=np.float32([k2[g.trainIdx].pt for g in good])
M,inl=cv2.estimateAffinePartial2D(p1,p2,method=cv2.RANSAC,ransacReprojThreshold=3,maxIters=20000)
print(M, 'inliers',inl.sum())
def geo(x,y):
  X=M@np.array([x,y,1.0]); return E0+X[0]*R, N1-X[1]*R
s=np.hypot(M[0,0],M[0,1]); print('scale m/px',s*R,'rot deg',np.degrees(np.arctan2(M[1,0],M[0,0])))
print('Cuckoo', geo(230,437),'Tor',geo(748,468))
res=p2[inl.ravel()==1]-(p1[inl.ravel()==1]@M[:,:2].T+M[:,2]); print('resid px rms',np.sqrt((res**2).sum(1).mean()))
# refine dot centres: dark blob centroid
for name,(cx,cy) in {'Cuckoo':(230,437),'Tor':(748,468)}.items():
  sub=img[cy-12:cy+13,cx-12:cx+13].astype(float)
  mk=sub<60
  ys,xs=np.nonzero(mk)
  # keep the blob nearest centre
  x=xs.mean()+cx-12; y=ys.mean()+cy-12
  print(name,'dot px',round(x,2),round(y,2),'n',mk.sum(),'geo',geo(x,y))
