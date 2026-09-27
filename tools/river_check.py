import struct, numpy as np
D='data/flyover/'
def grid(n):
    b=open(D+n,'rb').read(); _,_,nx,ny,x0,z0,dx,dz,hmin,hs=struct.unpack('<4s3I6f',b[:40])
    q=np.frombuffer(b,np.uint16,nx*ny,64).reshape(ny,nx)*hs+hmin
    return dict(nx=nx,ny=ny,x0=x0,z0=z0,dx=dx,dz=dz,h=q)
def samp(g,x,z,stride=1):
    fx=(x-g['x0'])/(g['dx']*stride); fz=(z-g['z0'])/(g['dz']*stride)
    H=g['h'][::stride,::stride]; ny,nx=H.shape
    if not (0<=fx<=nx-1 and 0<=fz<=ny-1): return None
    i=min(nx-2,int(fx)); j=min(ny-2,int(fz)); u=fx-i; v=fz-j
    if u+v<=1: return H[j,i]+u*(H[j,i+1]-H[j,i])+v*(H[j+1,i]-H[j,i])
    h11=H[j+1,i+1]; return h11+(1-u)*(H[j+1,i]-h11)+(1-v)*(H[j,i+1]-h11)
det=grid('detail.bin')
b=open(D+'river.bin','rb').read(); _,_,nv,ni=struct.unpack('<4s3I',b[:16])
P=np.frombuffer(b,np.float32,nv*3,16).reshape(-1,3)
worst=[]
for k in range(0,nv,2):
    for t in (0.0,0.5,1.0):
        x,y,z=P[k]*(1-t)+P[k+1]*t
        h0=samp(det,x,z); h1=samp(det,x,z,2)
        if h0 is None or h1 is None: continue
        worst.append((max(h0,h1)-y, k, round(float(x)),round(float(z)), round(float(h0-y),2), round(float(h1-y),2)))
worst.sort(reverse=True)
for w in worst[:15]: print(w)
print('n above', sum(1 for w in worst if w[0]>0), 'of', len(worst))
print('--- interior samples of ribbon quads')
res=[]
for k in range(0,nv-2,2):
    a,bb,c,d=P[k],P[k+1],P[k+2],P[k+3]
    if np.hypot(*(c-a)[[0,2]])>200: continue
    for s in np.linspace(0,1,5):
        for t in np.linspace(0,1,9):
            p=(a*(1-t)+bb*t)*(1-s)+(c*(1-t)+d*t)*s  # bilinear approx of the two triangles
            x,y,z=p; h0=samp(det,x,z); h1=samp(det,x,z,2)
            if h0 is None or h1 is None: continue
            res.append((max(h0,h1)-y,round(float(x)),round(float(z)),round(float(h0-y),2),round(float(h1-y),2)))
res.sort(reverse=True); print(res[:12]); print('above ground: LOD0',sum(r[3]>0 for r in res),'LOD1',sum(r[4]>0 for r in res),'of',len(res))
print('--- Avon vs coarse outside detail')
co=grid('coarse.bin'); res=[]
for k in range(0,nv-2,2):
    a,bb,c,d=P[k],P[k+1],P[k+2],P[k+3]
    if np.hypot(*(c-a)[[0,2]])>200: continue
    for s in np.linspace(0,1,5):
        for t in np.linspace(0,1,9):
            x,y,z=(a*(1-t)+bb*t)*(1-s)+(c*(1-t)+d*t)*s
            if samp(det,x,z) is not None: continue
            h=samp(co,x,z)
            if h is None: continue
            res.append((round(float(h-y),2),round(float(x)),round(float(z))))
res.sort(reverse=True); print(res[:8]); print('above', sum(r[0]>0 for r in res), 'of', len(res))
