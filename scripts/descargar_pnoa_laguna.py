#!/usr/bin/env python3
"""Descarga las teselas de la ortofoto PNOA (IGN/CNIG, CC-BY 4.0) de Laguna de Duero y las mete en un zip.

Uso (Windows, macOS o Linux; solo Python 3, sin instalar nada):
    python descargar_pnoa_laguna.py          (en Windows también vale: py descargar_pnoa_laguna.py)
Resultado: pnoa-laguna-z13-19.zip  (carpetas z/x/y.jpg, esquema XYZ de Web Mercator)
Si se corta, vuelve a ejecutarlo: sigue donde lo dejó (las teselas ya bajadas están en pnoa-laguna/).
Opcional: --dry-run  (solo cuenta teselas)
"""
import math, os, sys, time, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor

# bbox de las 8 hojas LiDAR (ETRS89 UTM 30N X 355000-358000, Y 4603000-4606000) en grados WGS84,
# con un margen de ~150 m para que no se vea el borde.
WEST, EAST, SOUTH, NORTH = -4.7418, -4.7012, 41.5642, 41.5945
ZOOMS = range(13, 20)  # z19 = 0,22 m/px a esta latitud, la resolución nativa del PNOA (25 cm)
# Primero el espejo TMS de IDEE (fila invertida), y si falla el WMTS del IGN (misma imagen).
TMS = os.environ.get("PNOA_TMS", "https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{ty}.jpeg")
WMTS = os.environ.get("PNOA_WMTS", "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
                      "&LAYER=OI.OrthoimageCoverage&STYLE=default&FORMAT=image/jpeg"
                      "&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}")
DIR = "pnoa-laguna"
OUT = "pnoa-laguna-z13-19.zip"
LEEME = ("Ortofoto PNOA maxima actualidad CC-BY 4.0 scne.es (https://www.scne.es/). "
         "PNOA cedido por (c) Instituto Geografico Nacional. Teselas sin modificar, descargadas el "
         + time.strftime("%Y-%m-%d") + " de " + TMS.split("/1.0.0")[0] + " (o del WMTS www.ign.es/wmts/pnoa-ma). "
         f"Esquema XYZ Web Mercator (EPSG:3857), 256 px, z13-z19, bbox lon {WEST}..{EAST} lat {SOUTH}..{NORTH}.\n")


def tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tiles():
    for z in ZOOMS:
        x0, y0 = tile(WEST, NORTH, z)
        x1, y1 = tile(EAST, SOUTH, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                yield z, x, y


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "geotwin-cloud ortho fetch (uso unico)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    if data[:2] != b"\xff\xd8":
        raise ValueError("la respuesta no es un JPEG")
    return data


def fetch(z, x, y):
    urls = [TMS.format(z=z, x=x, ty=2 ** z - 1 - y), WMTS.format(z=z, x=x, y=y)]
    error = None
    for intento in range(3):
        for url in urls:
            try:
                return get(url)
            except Exception as e:  # prueba el otro servidor y luego reintenta con espera creciente
                error = e
        time.sleep(2 * (intento + 1))
    raise RuntimeError(error)


def bajar(t):
    z, x, y = t
    path = os.path.join(DIR, str(z), str(x), f"{y}.jpg")
    if os.path.exists(path):
        return None
    try:
        data = fetch(z, x, y)
    except Exception as e:
        return f"{z}/{x}/{y}: {e}"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "wb") as f:
        f.write(data)
    os.replace(path + ".tmp", path)
    time.sleep(0.05)  # no saturar el servicio
    return None


def main():
    todo = list(tiles())
    print(f"{len(todo)} teselas (z{ZOOMS.start}-z{ZOOMS.stop - 1})")
    if "--dry-run" in sys.argv:
        return
    fallos = []
    with ThreadPoolExecutor(max_workers=4) as pool:  # 4 descargas a la vez, sin abusar del servidor
        for i, fallo in enumerate(pool.map(bajar, todo), 1):
            if fallo:
                fallos.append(fallo)
                if len(fallos) >= 20 and len(fallos) == i:
                    pool.shutdown(wait=False, cancel_futures=True)
                    sys.exit(f"No responde ningún servidor del PNOA ({fallo}). ¿Hay conexión? Prueba más tarde.")
            if i % 200 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)}")
    if fallos:
        print(f"Faltan {len(fallos)} teselas (por ejemplo {fallos[0]}). Vuelve a ejecutar el script para completarlas.")
        sys.exit(1)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_STORED) as zf:
        for z, x, y in todo:
            zf.write(os.path.join(DIR, str(z), str(x), f"{y}.jpg"), f"{z}/{x}/{y}.jpg")
        zf.writestr("LEEME.txt", LEEME)
    print(f"Hecho: {os.path.abspath(OUT)} ({os.path.getsize(OUT) / 1e6:.1f} MB). Ya puedes borrar la carpeta {DIR}.")


if __name__ == "__main__":
    main()
