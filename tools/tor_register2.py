import numpy as np, cv2, tifffile
exec(open('tools/tor_register.py').read().split("img=cv2.imread")[0])
sift=cv2.SIFT_create(8000); k2,d2=sift.detectAndCompute(hs8,None)
t=tifffile.imread(os.path.join(EA_DTM, 'SU14se_DTM_1m.tif'))
def z(e,n): return t[int(145000-n), int(e-415000)]
for fn in [os.path.join(os.environ.get('FLYOVER_SOURCES', 'sources'), 'he', 'torv-%03d.jpg' % k) for k in range(4)]:
  img=cv2.imread(fn,0)
  k1,d1=sift.detectAndCompute(img,None)
  m=cv2.BFMatcher().knnMatch(d1,d2,k=2); good=[a for a,b in m if a.distance<0.8*b.distance]
  p1=np.float32([k1[g.queryIdx].pt for g in good]); p2=np.float32([k2[g.trainIdx].pt for g in good])
  M,inl=cv2.estimateAffinePartial2D(p1,p2,method=cv2.RANSAC,ransacReprojThreshold=3,maxIters=20000)
  Mi=cv2.invertAffineTransform(M)
  def px(e,n): 
    X=np.array([(e-E0)/R,(N1-n)/R,1.0]); return Mi@X
  def geo(x,y):
    X=M@np.array([x,y,1.0]); return E0+X[0]*R, N1-X[1]*R
  out=[fn,'inl',int(inl.sum()),'scale',round(np.hypot(*M[0,:2])*R,3)]
  res={}
  for name,(e,n) in {'Cuckoo':(414658,143344),'Tor':(417350,143185)}.items():
    cx,cy=px(e,n); cx=int(round(cx)); cy=int(round(cy))
    sub=img[cy-10:cy+11,cx-10:cx+11].astype(float); ys,xs=np.nonzero(sub<60)
    if len(xs)<10: out.append((name,'nodot')); continue
    # largest compact cluster: take pixels within 5px of median
    mx,my=np.median(xs),np.median(ys); k=(abs(xs-mx)<6)&(abs(ys-my)<6)
    g=geo(xs[k].mean()+cx-10, ys[k].mean()+cy-10); res[name]=g
    out.append((name,round(g[0],1),round(g[1],1),int(k.sum())))
  if 'Cuckoo' in res and 'Tor' in res:
    de=414658-res['Cuckoo'][0]; dn=143344-res['Cuckoo'][1]
    out.append(('Tor corrected',round(res['Tor'][0]+de,1),round(res['Tor'][1]+dn,1)))
  print(*out)
for e,n in [(417351,143183),(417359,143180)]: print('DTM z',e,n,z(e,n))
