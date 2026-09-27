// OSGB36 National Grid (E,N) → WGS84 lat/lon. Airy 1830 TM inverse + Helmert. No deps.
export function osgbFromLocal(x, z, CE, CN) { return { e: CE + x, n: CN - z }; }

export function osgbToWgs84(easting, northing) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180, lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n, n3 = n2 * n;
  const N = northing - N0, E = easting - E0;
  let lat = lat0 + N / (a * F0);
  let M = 0;
  for (let i = 0; i < 10; i++) {
    M = b * F0 * (
      (1 + n + (5/4)*n2 + (5/4)*n3) * (lat - lat0)
      - (3*n + 3*n2 + (21/8)*n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0)
      + ((15/8)*n2 + (15/8)*n3) * Math.sin(2*(lat - lat0)) * Math.cos(2*(lat + lat0))
      - (35/24)*n3 * Math.sin(3*(lat - lat0)) * Math.cos(3*(lat + lat0))
    );
    const dLat = (N - M) / (a * F0);
    lat += dLat;
    if (Math.abs(dLat) < 1e-12) break;
  }
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const tanLat = Math.tan(lat);
  const secLat = 1 / cosLat;
  const dE = E, dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2, dE5 = dE4 * dE, dE6 = dE3 * dE3;
  const VII = tanLat / (2 * rho * nu);
  const VIII = tanLat / (24 * rho * nu * nu * nu) * (5 + 3*tanLat*tanLat + eta2 - 9*tanLat*tanLat*eta2);
  const IX = tanLat / (720 * rho * nu * nu * nu * nu * nu) * (61 + 90*tanLat*tanLat + 45*tanLat*tanLat*tanLat*tanLat);
  const X = secLat / nu;
  const XI = secLat / (6 * nu * nu * nu) * (nu / rho + 2*tanLat*tanLat);
  const XII = secLat / (120 * nu * nu * nu * nu * nu) * (5 + 28*tanLat*tanLat + 24*tanLat*tanLat*tanLat*tanLat);
  const XIIA = secLat / (5040 * nu * nu * nu * nu * nu * nu * nu) * (61 + 662*tanLat*tanLat + 1320*tanLat*tanLat*tanLat*tanLat + 720*Math.pow(tanLat,6));
  lat = lat - VII*dE2 + VIII*dE4 - IX*dE6;
  let lon = lon0 + X*dE - XI*dE3 + XII*dE5 - XIIA*dE*dE*dE*dE*dE*dE*dE;
  const sinL = Math.sin(lat), cosL = Math.cos(lat), sinO = Math.sin(lon), cosO = Math.cos(lon);
  const nuA = a / Math.sqrt(1 - e2 * sinL * sinL);
  const H = 0;
  let x = (nuA + H) * cosL * cosO;
  let y = (nuA + H) * cosL * sinO;
  let z = (nuA * (1 - e2) + H) * sinL;
  const tx = 446.448, ty = -125.157, tz = 542.060;
  const s = -20.4894e-6;
  const rx = (0.1502 * Math.PI / 648000), ry = (0.2470 * Math.PI / 648000), rz = (0.8421 * Math.PI / 648000);
  const x2 = tx + (1+s)*x + (-rz)*y + (ry)*z;
  const y2 = ty + (rz)*x + (1+s)*y + (-rx)*z;
  const z2 = tz + (-ry)*x + (rx)*y + (1+s)*z;
  const aW = 6378137.0, bW = 6356752.3142;
  const e2W = 1 - (bW*bW)/(aW*aW);
  const pxy = Math.sqrt(x2*x2 + y2*y2);
  let latW = Math.atan2(z2, pxy * (1 - e2W));
  for (let i = 0; i < 6; i++) {
    const nuW = aW / Math.sqrt(1 - e2W * Math.sin(latW) * Math.sin(latW));
    latW = Math.atan2(z2 + e2W * nuW * Math.sin(latW), pxy);
  }
  const lonW = Math.atan2(y2, x2);
  return { lat: latW * 180 / Math.PI, lon: lonW * 180 / Math.PI };
}
