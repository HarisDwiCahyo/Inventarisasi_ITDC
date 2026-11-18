#!/usr/bin/env python3
"""
Siapkan lapisan bahaya (banjir dan erosi) untuk Peta Inventarisasi Bencana ITDC.

Keluaran berupa PNG beralih-warna + satu berkas indeks `data/bahaya.json`,
jadi situs tetap statis dan tidak perlu pustaka raster di browser. Tiap PNG
dipasang sebagai L.imageOverlay memakai bounds dari berkas indeks.

Lapisan yang dibuat
  banjir : kedalaman genangan (meter), per skenario x periode x return period
           - Nusa Dua  : stack COG v5 (sudah WGS84)
           - Mandalika : ENSEMBLE median v5 (UTM 50S, direproyeksi)
  erosi  : mundurnya garis pantai (meter) pada sel yang terklasifikasi erosi,
           per skenario x tahun, dari stack proyeksi SLR Bruun kedua kawasan.

Golo Mori belum punya data model, jadi dilewati dan ditandai di indeks.

Jalankan : python3 tools/build_bahaya.py   (dari folder Inventarisasi_ITDC)
Kebutuhan: rasterio, numpy, Pillow
"""
import base64
import io
import json
import os
import sys


def _fix_proj_gdal_data():
    prefix = sys.prefix
    candidates = {
        "PROJ_LIB": [os.path.join(prefix, "Library", "share", "proj"),
                     os.path.join(prefix, "share", "proj")],
        "PROJ_DATA": [os.path.join(prefix, "Library", "share", "proj"),
                      os.path.join(prefix, "share", "proj")],
        "GDAL_DATA": [os.path.join(prefix, "Library", "share", "gdal"),
                      os.path.join(prefix, "share", "gdal")],
    }
    for var, paths in candidates.items():
        for p in paths:
            if os.path.isdir(p):
                os.environ[var] = p
                break


_fix_proj_gdal_data()

import numpy as np
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, ".."))
PRAKTIKUM = os.path.abspath(os.path.join(APP, "..", ".."))
OUT_DIR = os.path.join(APP, "data", "bahaya")
INDEKS = os.path.join(APP, "data", "bahaya.json")

# --- kelas legenda ---------------------------------------------------------
# Kedalaman banjir: sama dengan poster peta keterpaparan dan aplikasi web banjir.
KELAS_BANJIR = [
    (0.05, 0.10, "#deebf7", "0,05 - 0,10"),
    (0.10, 0.25, "#9ecae1", "0,10 - 0,25"),
    (0.25, 0.50, "#6baed6", "0,25 - 0,50"),
    (0.50, 0.75, "#3182bd", "0,50 - 0,75"),
    (0.75, 1.00, "#08519c", "0,75 - 1,00"),
    (1.00, float("inf"), "#08306b", "lebih dari 1,00"),
]
# Mundurnya garis pantai pada sel yang terklasifikasi erosi, satuan meter.
KELAS_EROSI = [
    (0.0, 5.0, "#fee5d9", "0 - 5"),
    (5.0, 10.0, "#fcae91", "5 - 10"),
    (10.0, 15.0, "#fb6a4a", "10 - 15"),
    (15.0, 20.0, "#de2d26", "15 - 20"),
    (20.0, 25.0, "#a50f15", "20 - 25"),
    (25.0, float("inf"), "#67000d", "lebih dari 25"),
]

TAHUN_EROSI = [2030, 2035, 2040, 2045, 2050, 2055, 2060]
SSP_LABEL = {
    "ssp126": "SSP 1-2.6 (emisi sangat rendah)",
    "ssp245": "SSP 2-4.5 (emisi rendah)",
    "ssp370": "SSP 3-7.0 (emisi sedang)",
    "ssp585": "SSP 5-8.5 (emisi tinggi)",
}
# Pemetaan nama folder erosi ke kode skenario.
EROSI_DIR = {
    "nusa_dua": {
        "ssp126": "SSP 126", "ssp245": "SSP 245", "ssp370": "SSP 370", "ssp585": "SSP 585",
    },
    "mandalika": {
        "ssp126": "SSP1-2.6", "ssp245": "SSP2-4.5", "ssp370": "SSP3-7.0", "ssp585": "SSP5-8.5",
    },
}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def tulis_png(rgba, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(path, format="PNG", optimize=True)
    return os.path.getsize(path)


def warnai(arr, kelas):
    """Larik nilai menjadi RGBA; sel di luar kelas dibuat transparan."""
    rgba = np.zeros(arr.shape + (4,), dtype=np.uint8)
    valid = np.isfinite(arr)
    for lo, hi, hexc, _ in kelas:
        r, g, b = hex_rgb(hexc)
        m = valid & (arr >= lo) & (arr < hi)
        rgba[m, 0], rgba[m, 1], rgba[m, 2], rgba[m, 3] = r, g, b, 255
    return rgba


def bounds_leaflet(transform, width, height):
    """[[selatan, barat], [utara, timur]] seperti yang diminta L.imageOverlay."""
    west, north = transform.c, transform.f
    east = west + width * transform.a
    south = north + height * transform.e
    return [[round(south, 7), round(west, 7)], [round(north, 7), round(east, 7)]]


def reproyeksi(src_arr, src_transform, src_crs, resampling, nodata):
    transform, width, height = calculate_default_transform(
        src_crs, "EPSG:4326", src_arr.shape[1], src_arr.shape[0],
        *rasterio.transform.array_bounds(src_arr.shape[0], src_arr.shape[1], src_transform)[:4]
    )
    dst = np.full((height, width), nodata, dtype="float32")
    reproject(
        source=src_arr.astype("float32"), destination=dst,
        src_transform=src_transform, src_crs=src_crs,
        dst_transform=transform, dst_crs="EPSG:4326",
        src_nodata=nodata, dst_nodata=nodata,
        resampling=resampling,
    )
    return dst, transform


# --- banjir ----------------------------------------------------------------

def banjir_nusa_dua():
    """Stack COG v5 Nusa Dua: 20 band per skenario, sudah EPSG:4326."""
    root = os.path.join(PRAKTIKUM, "App Flood", "Nusa Dua", "web", "data")
    with open(os.path.join(root, "manifest.json"), encoding="utf-8") as f:
        man = json.load(f)
    periode, rps = man["decades"], man["return_periods"]
    bounds, total = None, 0
    for ssp in man["scenarios"]:
        with rasterio.open(os.path.join(root, os.path.basename(man["scenarios"][ssp]["file"]))) as ds:
            if bounds is None:
                bounds = bounds_leaflet(ds.transform, ds.width, ds.height)
            for di, per in enumerate(periode):
                for ti, T in enumerate(rps):
                    arr = ds.read(di * len(rps) + ti + 1)
                    nama = "%s_%s_T%d.png" % (ssp, per, T)
                    total += tulis_png(warnai(arr, KELAS_BANJIR),
                                       os.path.join(OUT_DIR, "banjir", "nusa_dua", nama))
    return {
        "bounds": bounds,
        "skenario": [{"id": s, "label": SSP_LABEL.get(s, s)} for s in man["scenarios"]],
        "periode": periode,
        "return_period": rps,
        "berkas": "data/bahaya/banjir/nusa_dua/{skenario}_{periode}_T{T}.png",
        "catatan": "Kedalaman genangan hasil pemodelan hidrologi-hidraulika Nusa Dua v5.",
    }, total


def banjir_mandalika():
    """ENSEMBLE median v5 Mandalika: satu berkas per kombinasi, UTM 50S."""
    root = os.path.join(PRAKTIKUM, "App Flood", "Mandalika", "Output_Kedalaman_v5_ENSEMBLE")
    skenario = ["ssp126", "ssp245", "ssp370", "ssp585"]
    periode = ["2030", "2035", "2040", "2045", "2050", "2055", "2060"]
    rps = [5, 10, 25, 50]
    bounds, total = None, 0
    for ssp in skenario:
        for per in periode:
            for T in rps:
                src = os.path.join(root, ssp, per,
                                   "Ensemble_Mandalika_v5_%s_%s_T%d_median.tif" % (ssp, per, T))
                with rasterio.open(src) as ds:
                    arr, transform = reproyeksi(ds.read(1), ds.transform, ds.crs,
                                                Resampling.bilinear, np.nan)
                if bounds is None:
                    bounds = bounds_leaflet(transform, arr.shape[1], arr.shape[0])
                nama = "%s_%s_T%d.png" % (ssp, per, T)
                total += tulis_png(warnai(arr, KELAS_BANJIR),
                                   os.path.join(OUT_DIR, "banjir", "mandalika", nama))
    return {
        "bounds": bounds,
        "skenario": [{"id": s, "label": SSP_LABEL[s]} for s in skenario],
        "periode": periode,
        "return_period": rps,
        "berkas": "data/bahaya/banjir/mandalika/{skenario}_{periode}_T{T}.png",
        "catatan": "Kedalaman genangan ENSEMBLE median lima GCM, pemodelan Mandalika v5.",
    }, total


# --- erosi -----------------------------------------------------------------

def jalur_erosi(kawasan, ssp, tahun):
    folder = EROSI_DIR[kawasan][ssp]
    if kawasan == "nusa_dua":
        return os.path.join(PRAKTIKUM, "Erosion", "Code Nusa Dua", "code_kering", folder,
                            "hasil", "slr_bruun", "stack_proyeksi_%d.tif" % tahun)
    return os.path.join(PRAKTIKUM, "Erosion", "Code Mandalika", "Hasil 08 SLR Bruun", folder,
                        "stack_proyeksi_%d.tif" % tahun)


def erosi_kawasan(kawasan):
    """Mundurnya garis pantai (meter) pada sel kelas erosi, per skenario dan tahun.

    Band 7 = D_retreat_total_m, band 8 = kelas (1 erosi, 2 akresi, 0 stabil).
    Nilai di luar sel erosi dibuang supaya peta tidak mewarnai daratan yang
    sebenarnya tidak tergerus.
    """
    skenario = list(EROSI_DIR[kawasan].keys())
    grid, transform = {}, None
    for ssp in skenario:
        for tahun in TAHUN_EROSI:
            path = jalur_erosi(kawasan, ssp, tahun)
            with rasterio.open(path) as ds:
                mundur = ds.read(7)
                kelas = ds.read(8)
                nilai = np.where((kelas == 1) & (mundur > -9000), mundur, np.nan)
                arr, transform = reproyeksi(nilai, ds.transform, ds.crs,
                                            Resampling.nearest, np.nan)
            grid[(ssp, tahun)] = arr

    # Potong ke kotak data gabungan supaya berkas kecil dan semua lapisan sebingkai.
    union = np.zeros_like(next(iter(grid.values())), dtype=bool)
    for a in grid.values():
        union |= np.isfinite(a)
    rows, cols = np.where(union)
    pad = 10
    r0, r1 = max(0, rows.min() - pad), min(union.shape[0], rows.max() + pad + 1)
    c0, c1 = max(0, cols.min() - pad), min(union.shape[1], cols.max() + pad + 1)
    sub = rasterio.windows.transform(rasterio.windows.Window(c0, r0, c1 - c0, r1 - r0), transform)
    bounds = bounds_leaflet(sub, c1 - c0, r1 - r0)

    total, luas = 0, {}
    for (ssp, tahun), arr in grid.items():
        potong = arr[r0:r1, c0:c1]
        nama = "%s_%d.png" % (ssp, tahun)
        total += tulis_png(warnai(potong, KELAS_EROSI),
                           os.path.join(OUT_DIR, "erosi", kawasan, nama))
        luas.setdefault(ssp, {})[tahun] = int(np.isfinite(potong).sum())

    return {
        "bounds": bounds,
        "skenario": [{"id": s, "label": SSP_LABEL[s]} for s in skenario],
        "tahun": TAHUN_EROSI,
        "berkas": "data/bahaya/erosi/%s/{skenario}_{tahun}.png" % kawasan,
        "catatan": "Mundurnya garis pantai pada sel yang terklasifikasi erosi, "
                   "proyeksi laju alami ditambah kenaikan muka laut (aturan Bruun).",
    }, total, luas


def main():
    hasil, ringkas = {}, []

    print("Banjir Nusa Dua")
    nd_banjir, b1 = banjir_nusa_dua()
    ringkas.append(("banjir nusa_dua", b1))

    print("Banjir Mandalika")
    md_banjir, b2 = banjir_mandalika()
    ringkas.append(("banjir mandalika", b2))

    print("Erosi Nusa Dua")
    nd_erosi, b3, luas_nd = erosi_kawasan("nusa_dua")
    ringkas.append(("erosi nusa_dua", b3))

    print("Erosi Mandalika")
    md_erosi, b4, luas_md = erosi_kawasan("mandalika")
    ringkas.append(("erosi mandalika", b4))

    hasil = {
        "legenda": {
            "banjir": {
                "judul": "Kedalaman banjir (meter)",
                "kelas": [{"warna": c[2], "label": c[3]} for c in KELAS_BANJIR],
            },
            "erosi": {
                "judul": "Mundurnya garis pantai (meter)",
                "kelas": [{"warna": c[2], "label": c[3]} for c in KELAS_EROSI],
            },
        },
        "kawasan": {
            "nusa_dua": {"banjir": nd_banjir, "erosi": nd_erosi},
            "mandalika": {"banjir": md_banjir, "erosi": md_erosi},
            "golo_mori": {},
        },
    }
    with open(INDEKS, "w", encoding="utf-8") as f:
        json.dump(hasil, f, ensure_ascii=False, indent=1)

    print("\nRingkasan ukuran berkas")
    for nama, b in ringkas:
        print("  %-18s %6.2f MB" % (nama, b / 1e6))
    print("  total              %6.2f MB" % (sum(b for _, b in ringkas) / 1e6))
    print("Indeks ditulis:", os.path.relpath(INDEKS, APP))
    for kw, luas in (("nusa_dua", luas_nd), ("mandalika", luas_md)):
        contoh = luas["ssp245"]
        print("  cek erosi %-10s ssp245: %d sel (2030) sampai %d sel (2060)"
              % (kw, contoh[2030], contoh[2060]))


if __name__ == "__main__":
    main()
