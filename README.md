# Peta Inventarisasi Kejadian Bencana Kawasan ITDC

Situs statis untuk mencatat kejadian bencana yang merugikan kawasan ITDC:
Nusa Dua, Mandalika, dan Golo Mori. Pengguna memilih kawasan, menggambar
geometri kejadian (titik, garis, atau area), lalu mengisi formulir kerugian.
Geometri disimpan sebagai GeoJSON, datanya masuk ke Google Spreadsheet
lewat Apps Script.

## Isi folder

```
index.html              halaman utama
assets/style.css        tampilan
assets/app.js           seluruh logika peta, formulir, dan sinkronisasi
assets/config.js        URL Apps Script dan nama pencatat bawaan  <- yang perlu diisi
data/kawasan.json       batas kawasan, bbox, zona Mandalika, acuan citra
data/*.jpg              peta masterplan tiap kawasan (sudah diluruskan ke Web Mercator)
vendor/                 Leaflet 1.9.4 dan SheetJS 0.18.5 (lokal, tanpa CDN)
apps-script/Code.gs     contoh backend spreadsheet, siap tempel
```

## Cara menjalankan

Situs harus dilayani lewat HTTP, bukan dibuka langsung sebagai berkas
(`file://` memblokir pembacaan `data/kawasan.json`).

```bash
cd "App Bencana"
python3 -m http.server 8777
# buka http://localhost:8777
```

Untuk hosting: unggah seluruh isi folder apa adanya ke GitHub Pages,
Netlify, atau hosting statis mana pun. Fitur "lokasi saya" hanya aktif
pada HTTPS atau localhost.

## Menyambungkan ke Google Spreadsheet

1. Buat spreadsheet baru, misal "Inventarisasi Bencana ITDC".
2. **Extensions > Apps Script**, tempel `apps-script/Code.gs`, simpan.
3. **Deploy > New deployment > Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Salin URL yang berakhiran `/exec`.
5. Isi di `assets/config.js` pada `URL_APPS_SCRIPT` (berlaku untuk semua
   pengguna), atau lewat tombol **Pengaturan** di situs (tersimpan per
   perangkat). Tombol **Uji sambungan** memastikan URL benar.

Sheet `Kejadian` dibuat otomatis beserta barisnya. Baris yang dihapus dari
peta tidak dibuang, hanya ditandai `dihapus = true` dan dicoret, supaya
riwayat lapangan tetap utuh.

### Kontrak data (kalau Apps Script ditulis sendiri)

Situs memanggil empat hal berikut. Selama balasan berbentuk sama,
backend boleh ditulis ulang sesuka hati.

| Panggilan | Metode | Parameter | Balasan |
|---|---|---|---|
| Uji sambungan | GET | `?action=ping&callback=FN` | `{ ok: true, spreadsheet: "nama" }` |
| Ambil data | GET | `?action=list&kawasan=nusa_dua&callback=FN` | `{ ok: true, data: [ {…rekaman}, … ] }` |
| Simpan | POST | badan `{"action":"simpan","data":{…rekaman}}` | `{ ok: true, uid, kode }` |
| Hapus | POST | badan `{"action":"hapus","uid":"…"}` | `{ ok: true, uid }` |

Catatan teknis yang membuat pemanggilan ini berhasil dari browser:

- **GET memakai JSONP** (parameter `callback`), karena Apps Script tidak
  mengirim header CORS pada semua kasus. Balasan harus dibungkus
  `FN({...});` dengan MIME `JAVASCRIPT`.
- **POST memakai `Content-Type: text/plain;charset=utf-8`** supaya browser
  tidak mengirim preflight `OPTIONS` yang tidak dilayani Apps Script.
  Isi badan tetap JSON.
- Server yang menetapkan `kode` berurutan (`ND-001`, `MDL-001`, `GM-001`);
  situs mengirim `uid` unik buatan sendiri sebagai kunci baris.

### Kolom pada sheet

`kode`, `uid`, `kawasan`, `jenis`, `jenis_lain`, `kelas_bahaya`, `tahun`, `bulan`,
`musim`, `tanggal_mulai`,
`tanggal_selesai`, `lama_jam`, `keparahan`, `lokasi`, `aset_terdampak`,
`dampak`, `kedalaman_cm`, `tinggi_gelombang_m`, `panjang_terdampak_m`,
`luas_terdampak_m2`, `kerugian_rp`, `biaya_penanganan_rp`, `penanganan`,
`sumber`, `sumber_detail`, `pencatat`, `catatan`,
`tipe_geometri`, `lat`, `lon`, `geometry_geojson`, `dibuat`, `diperbarui`,
`dihapus`.

`geometry_geojson` berisi geometri GeoJSON lengkap (`Point`, `LineString`,
atau `Polygon`, derajat desimal WGS 84). Panjang dan luas hasil ukur peta
ditampilkan di formulir tetapi sengaja tidak disimpan, angka itu selalu bisa
dihitung ulang dari geometri. Yang tersimpan hanya `panjang_terdampak_m` dan
`luas_terdampak_m2`, yakni angka yang diisi manual oleh pencatat.

Menambah kolom baru cukup dengan menambahnya pada `HEADERS` di `Code.gs`;
kolom lama tidak bergeser.

Daftar jenis kejadian disusun mengikuti pembagian bahaya fisik pada SPK 2,
yang setara dengan IFRS S2: **bahaya akut** untuk kejadian mendadak seperti
banjir, hujan ekstrem, dan gelombang tinggi, serta **bahaya kronis** untuk
perubahan bertahap seperti kenaikan muka air laut, abrasi, intrusi air laut,
dan kenaikan suhu rata-rata. Kolom `kelas_bahaya` terisi sendiri mengikuti
jenis yang dipilih, jadi tabel pengungkapan tinggal dipivot dari kolom itu.
Bahaya geologis seperti gempa bumi tidak dimasukkan karena di luar lingkup
risiko iklim.

Isian parameter fisik menyesuaikan jenisnya. Kedalaman genangan hanya muncul
untuk banjir dan rob, tinggi gelombang hanya untuk gelombang tinggi, dan untuk
jenis tanpa parameter seperti gelombang panas seluruh bloknya disembunyikan.

Waktu kejadian bisa diisi sekasar apa pun ingatan narasumber. Urutannya tahun
dulu, lalu bulan, lalu musim, dan tanggal persis hanya diisi kalau memang masih
diingat. Ketiganya saling melengkapi: mengisi tanggal persis akan menurunkan
tahun dan bulannya sendiri, dan memilih bulan akan menurunkan musimnya.
Pembagian musim memakai pola Indonesia bagian selatan, yaitu November sampai
Maret musim hujan, Mei sampai September kemarau, serta April dan Oktober
pancaroba. Daftar kejadian tetap bisa diurutkan karena catatan yang hanya
bertahun pun punya kunci urut sendiri.

Satu-satunya isian wajib adalah **jenis kejadian**.

## Pemakaian di lapangan

- **Luring tetap jalan.** Semua catatan masuk ke penyimpanan browser dulu,
  lalu diantre. Status di kanan atas menunjukkan "Tersimpan di Sheets",
  "n menunggu", atau "Mode lokal". Tombol **Sinkron** mengirim antrean dan
  menarik ulang data terbaru.
- **Dari HP**, panel daftar muncul lewat tombol garis tiga, formulir
  membuka penuh layar, dan tombol lokasi memakai GPS perangkat.
- **Menggambar**: klik alat Titik/Garis/Area, lalu klik di peta. Klik ganda,
  tombol Selesai, atau Enter mengakhiri garis dan area; Backspace menghapus
  titik terakhir; Escape membatalkan.
- **Mengubah bentuk**: buka kejadian, tekan **Ubah geometri**, seret simpul.
  Simpul tengah yang pudar menambah titik baru, klik kanan pada simpul
  menghapusnya. Tekan Selesai, lalu **Simpan kejadian**.
- **Unduhan** tersedia dalam `.geojson` (untuk QGIS/ArcGIS), `.csv`, dan
  `.xlsx`.

## Lapisan peta

Peta dasar memakai layanan daring: citra satelit Esri, peta jalan
OpenStreetMap, dan topografi Esri. Lapisan tambahan: batas kawasan
(dari shapefile proyek), peta masterplan ITDC dengan penggeser transparansi,
serta zona Mandalika beserta kodenya.

Sumber batas: `Praktikum/Data/Nusa_Dua_final.shp`, `Mandalika_final.shp`,
`Golomori.shp`. Citra masterplan berasal dari `nusadua.jpg`, `mandalika.jpg`,
dan `golo mori.jpg` pada folder yang sama, diluruskan memakai world file
masing-masing. Perhatian: berkas `Golomori.prj` menyebut UTM 49S, padahal
koordinatnya Web Mercator (EPSG:3857), ini sudah dikoreksi saat penyiapan
data, jangan ikut memakai `.prj` itu apa adanya di QGIS.
