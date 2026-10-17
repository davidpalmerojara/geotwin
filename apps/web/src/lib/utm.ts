/**
 * ETRS89 geographic coordinates to UTM (zone 30 N by default) with Krüger's series to sixth order
 * in n (Karney 2011): millimetre accuracy within a zone, so the readout matches the PNOA sheets,
 * which are ETRS89 / UTM 30N (EPSG:25830). GRS80 ellipsoid; WGS84 differs by 0,1 mm here.
 */
const A_GRS80 = 6378137;
const F_GRS80 = 1 / 298.257222101;
const K0 = 0.9996;
const FALSE_EASTING = 500000;

const n = F_GRS80 / (2 - F_GRS80);
const n2 = n * n,
  n3 = n2 * n,
  n4 = n3 * n,
  n5 = n4 * n,
  n6 = n5 * n;
// Rectifying radius.
const RECT = (A_GRS80 / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const ALPHA = [
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
  (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
  (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
  (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
  (212378941 * n6) / 319334400,
];
// First eccentricity, written with n.
const E = (2 * Math.sqrt(n)) / (1 + n);

export interface Utm {
  zone: number;
  easting: number;
  northing: number;
}

/** UTM zone (1–60) of a longitude, without the Norway and Svalbard exceptions. */
export const utmZone = (lng: number) => Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));

/** ETRS89 longitude and latitude (degrees, northern hemisphere) to UTM easting and northing. */
export function toUtm(lng: number, lat: number, zone = 30): Utm {
  const phi = (lat * Math.PI) / 180;
  const lambda = ((lng - (zone * 6 - 183)) * Math.PI) / 180;
  const sin = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sin) - E * Math.atanh(E * sin));
  const xi0 = Math.atan2(t, Math.cos(lambda));
  const eta0 = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let xi = xi0,
    eta = eta0;
  ALPHA.forEach((a, i) => {
    const j = 2 * (i + 1);
    xi += a * Math.sin(j * xi0) * Math.cosh(j * eta0);
    eta += a * Math.cos(j * xi0) * Math.sinh(j * eta0);
  });
  return { zone, easting: FALSE_EASTING + K0 * RECT * eta, northing: K0 * RECT * xi };
}
