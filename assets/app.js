/* ==========================================================================
   Inventarisasi Kejadian Bencana Kawasan ITDC
   Peta interaktif: gambar titik / garis / area, isi formulir kejadian,
   simpan ke Google Spreadsheet lewat Apps Script, geometri disimpan GeoJSON.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------- pintasan */

  var $ = function (s, induk) { return (induk || document).querySelector(s); };
  var $$ = function (s, induk) { return Array.prototype.slice.call((induk || document).querySelectorAll(s)); };

  var KUNCI_SETELAN = 'itdc_bencana_setelan_v1';
  var KUNCI_ANTREAN = 'itdc_bencana_antrean_v1';
  var KUNCI_CACHE = 'itdc_bencana_cache_v1_';
  var KUNCI_TEMA = 'itdc_bencana_tema';

  /* ------------------------------------------------------------- referensi */

  // Daftar bahaya fisik mengikuti pembagian SPK 2 (setara IFRS S2):
  // akut untuk kejadian mendadak, kronis untuk perubahan yang berjalan lambat.
  // Semuanya bahaya yang dipicu atau diperkuat iklim; bahaya geologis seperti
  // gempa bumi sengaja tidak masuk karena di luar lingkup risiko iklim.
  var JENIS = [
    { nama: 'Banjir',                           kelas: 'akut',   warna: '#00c2ff', ikon: 'B',  par: ['kedalaman_cm', 'luas_terdampak_m2'] },
    { nama: 'Genangan rob dan banjir pesisir',  kelas: 'akut',   warna: '#1ee3cf', ikon: 'RB', par: ['kedalaman_cm', 'luas_terdampak_m2'] },
    { nama: 'Hujan ekstrem',                    kelas: 'akut',   warna: '#7bdcff', ikon: 'HE', par: ['luas_terdampak_m2'] },
    { nama: 'Angin kencang dan puting beliung', kelas: 'akut',   warna: '#c08bff', ikon: 'AK', par: ['luas_terdampak_m2'] },
    { nama: 'Gelombang tinggi dan badai laut',  kelas: 'akut',   warna: '#00e5a0', ikon: 'GT', par: ['tinggi_gelombang_m', 'panjang_terdampak_m'] },
    { nama: 'Tanah longsor',                    kelas: 'akut',   warna: '#ff8a3d', ikon: 'L',  par: ['luas_terdampak_m2', 'panjang_terdampak_m'] },
    { nama: 'Kebakaran lahan dan vegetasi',     kelas: 'akut',   warna: '#ff4d4d', ikon: 'KB', par: ['luas_terdampak_m2'] },

    { nama: 'Abrasi pantai',                      kelas: 'kronis', warna: '#ffd400', ikon: 'A',  par: ['panjang_terdampak_m', 'luas_terdampak_m2'] },
    { nama: 'Kekeringan dan defisit air',       kelas: 'kronis', warna: '#ffe97a', ikon: 'K',  par: ['luas_terdampak_m2'] },

    { nama: 'Lainnya',                          kelas: '',       warna: '#ffd400', ikon: '?',  par: ['kedalaman_cm', 'tinggi_gelombang_m', 'panjang_terdampak_m', 'luas_terdampak_m2'] }
  ];

  var NAMA_KELAS = { akut: 'Bahaya akut', kronis: 'Bahaya kronis' };

  var DAMPAK = [
    'Kerusakan bangunan / hotel',
    'Kerusakan jalan dan drainase',
    'Gangguan operasional hotel / venue',
    'Penutupan akses dan lalu lintas',
    'Pembatalan acara / kehilangan pendapatan',
    'Kerusakan lanskap dan vegetasi',
    'Gangguan utilitas (listrik, air)',
    'Kerusakan garis pantai / lahan',
    'Korban jiwa atau luka',
    'Lainnya'
  ];

  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  // Rentang bulan ikut ditampilkan supaya narasumber tidak perlu menerka
  // musim mana yang dimaksud. Yang tersimpan tetap nama musimnya saja.
  var MUSIM = [
    { nilai: 'Musim hujan',   label: 'Musim hujan (Nov-Mar)' },
    { nilai: 'Pancaroba',     label: 'Pancaroba (Apr dan Okt)' },
    { nilai: 'Musim kemarau', label: 'Musim kemarau (Mei-Sep)' }
  ];

  // Pembagian musim untuk Indonesia bagian selatan, tempat ketiga kawasan
  // berada: November sampai Maret hujan, Mei sampai September kemarau,
  // April dan Oktober peralihan.
  var MUSIM_BULAN = ['Musim hujan', 'Musim hujan', 'Musim hujan', 'Pancaroba',
    'Musim kemarau', 'Musim kemarau', 'Musim kemarau', 'Musim kemarau',
    'Musim kemarau', 'Pancaroba', 'Musim hujan', 'Musim hujan'];

  var MEDAN = ['jenis', 'jenis_lain', 'tahun', 'bulan', 'musim', 'tanggal_mulai', 'tanggal_selesai', 'lama_jam', 'keparahan',
    'lokasi', 'aset_terdampak', 'kedalaman_cm', 'tinggi_gelombang_m', 'panjang_terdampak_m',
    'luas_terdampak_m2', 'kerugian_rp', 'biaya_penanganan_rp', 'penanganan', 'sumber',
    'sumber_detail', 'pencatat', 'catatan'];

  /* ----------------------------------------------------------------- state */

  var S = {
    kawasan: null,        // objek konfigurasi kawasan aktif
    semuaKawasan: {},     // kawasan.json
    rekaman: {},          // uid -> rekaman (kawasan aktif)
    lapisan: {},          // uid -> layer Leaflet
    terpilih: null,       // uid terpilih
    draf: null,           // rekaman yang sedang diisi (belum tersimpan)
    peta: null,
    grupFitur: null,
    lapisBatas: null,
    lapisCitra: null,
    lapisZona: null,
    dasar: {},
    dasarAktif: 'satelit',
    gambar: null,         // { mode, titik: [LatLng], pratinjau, simpul: [] }
    sunting: null,        // { uid, simpul: [], lapis }
    setelan: { url: '', pencatat: '' },
    antrean: [],
    sibuk: false,
    ukurOtomatis: {}          // hasil ukur terakhir yang diisikan ke formulir
  };

  /* ------------------------------------------------------------- pembantu */

  function uidBaru(prefix) {
    return (prefix || 'KJD') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 6);
  }

  function amanJSON(teks, bawaan) {
    try { return JSON.parse(teks); } catch (e) { return bawaan; }
  }

  function bacaLokal(kunci, bawaan) {
    try {
      var v = localStorage.getItem(kunci);
      return v ? amanJSON(v, bawaan) : bawaan;
    } catch (e) { return bawaan; }
  }

  function tulisLokal(kunci, nilai) {
    try { localStorage.setItem(kunci, JSON.stringify(nilai)); } catch (e) { /* kuota penuh */ }
  }

  function infoJenis(nama) {
    for (var i = 0; i < JENIS.length; i++) if (JENIS[i].nama === nama) return JENIS[i];
    return JENIS[JENIS.length - 1];
  }

  function angka(v) {
    if (v === '' || v === null || v === undefined) return '';
    var n = Number(v);
    return isNaN(n) ? '' : n;
  }

  function fmtAngka(n, desimal) {
    if (n === '' || n === null || n === undefined || isNaN(n)) return '';
    return Number(n).toLocaleString('id-ID', {
      minimumFractionDigits: desimal || 0,
      maximumFractionDigits: desimal || 0
    });
  }

  function fmtPanjang(m) {
    if (!m) return '';
    return m >= 1000 ? fmtAngka(m / 1000, 2) + ' km' : fmtAngka(m, 0) + ' m';
  }

  function fmtLuas(m2) {
    if (!m2) return '';
    return m2 >= 10000 ? fmtAngka(m2 / 10000, 2) + ' ha' : fmtAngka(m2, 0) + ' m²';
  }

  function fmtTanggal(s) {
    if (!s) return '';
    var d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Satu kalimat waktu dari isian yang ada, sekasar apa pun ingatannya.
  function teksWaktu(rek) {
    if (rek.tanggal_mulai) return fmtTanggal(rek.tanggal_mulai);
    var bagian = [];
    if (rek.bulan) bagian.push(rek.bulan);
    else if (rek.musim) bagian.push(rek.musim);
    if (rek.tahun) bagian.push(rek.tahun);
    return bagian.length ? bagian.join(' ') : 'waktu belum diisi';
  }

  // Kunci pengurutan: tanggal persis kalau ada, kalau tidak dibangun dari
  // tahun dan bulan supaya catatan kasar tetap berurut bersama yang rinci.
  function kunciWaktu(rek) {
    if (rek.tanggal_mulai) return String(rek.tanggal_mulai);
    if (!rek.tahun) return '';
    var i = BULAN.indexOf(rek.bulan);
    var bln = i >= 0 ? ('0' + (i + 1)).slice(-2) : '00';
    return rek.tahun + '-' + bln + '-00';
  }

  function hariIni() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* ---------------------------------------------------------------- toast */

  var IKON_TOAST = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
    galat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 11v5M12 7h.01"/><circle cx="12" cy="12" r="9"/></svg>'
  };

  function toast(pesan, jenis, lama) {
    var wadah = $('#toast-wadah');
    var d = document.createElement('div');
    d.className = 'toast ' + (jenis || 'info');
    d.innerHTML = (IKON_TOAST[jenis] || IKON_TOAST.info) + '<span></span>';
    $('span', d).textContent = pesan;
    wadah.appendChild(d);
    setTimeout(function () {
      d.style.transition = 'opacity .25s';
      d.style.opacity = '0';
      setTimeout(function () { d.remove(); }, 260);
    }, lama || 3200);
  }

  function konfirmasi(judul, pesan, saatYa) {
    $('#konfirmasiJudul').textContent = judul;
    $('#konfirmasiPesan').textContent = pesan;
    $('#tiraiKonfirmasi').classList.add('buka');
    var ya = $('#konfirmasiYa');
    var baru = ya.cloneNode(true);
    ya.parentNode.replaceChild(baru, ya);
    baru.addEventListener('click', function () {
      $('#tiraiKonfirmasi').classList.remove('buka');
      saatYa();
    });
  }

  /* ------------------------------------------------------------- geometri */

  function panjangGaris(ll) {
    var s = 0;
    for (var i = 0; i < ll.length - 1; i++) s += ll[i].distanceTo(ll[i + 1]);
    return s;
  }

  function luasPoligon(ll) {
    if (!ll || ll.length < 3) return 0;
    var R = 6378137, rad = Math.PI / 180, luas = 0;
    for (var i = 0; i < ll.length; i++) {
      var p1 = ll[i], p2 = ll[(i + 1) % ll.length];
      luas += (p2.lng - p1.lng) * rad * (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad));
    }
    return Math.abs(luas * R * R / 2);
  }

  function keGeoJSON(mode, ll) {
    if (mode === 'titik') {
      return { type: 'Point', coordinates: [bulat(ll[0].lng), bulat(ll[0].lat)] };
    }
    if (mode === 'garis') {
      return { type: 'LineString', coordinates: ll.map(function (p) { return [bulat(p.lng), bulat(p.lat)]; }) };
    }
    var cincin = ll.map(function (p) { return [bulat(p.lng), bulat(p.lat)]; });
    cincin.push(cincin[0].slice());
    return { type: 'Polygon', coordinates: [cincin] };
  }

  function bulat(n) { return Math.round(n * 1e7) / 1e7; }

  function dariGeoJSON(g) {
    if (!g) return { mode: null, ll: [] };
    if (g.type === 'Point') return { mode: 'titik', ll: [L.latLng(g.coordinates[1], g.coordinates[0])] };
    if (g.type === 'LineString') {
      return { mode: 'garis', ll: g.coordinates.map(function (c) { return L.latLng(c[1], c[0]); }) };
    }
    if (g.type === 'Polygon') {
      var c = g.coordinates[0].slice();
      if (c.length > 1) {
        var a = c[0], b = c[c.length - 1];
        if (a[0] === b[0] && a[1] === b[1]) c.pop();
      }
      return { mode: 'area', ll: c.map(function (p) { return L.latLng(p[1], p[0]); }) };
    }
    return { mode: null, ll: [] };
  }

  // Hasil ukur dipakai untuk tampilan saja, tidak ikut disimpan ke spreadsheet.
  function ukurGeometri(rek) {
    var g = dariGeoJSON(amanJSON(rek.geometry_geojson, null));
    var hasil = { mode: g.mode, panjang: 0, luas: 0, lat: '', lon: '' };
    if (!g.mode) return hasil;
    if (g.mode === 'titik') {
      hasil.lat = bulat(g.ll[0].lat); hasil.lon = bulat(g.ll[0].lng);
    } else if (g.mode === 'garis') {
      hasil.panjang = Math.round(panjangGaris(g.ll));
      var t = g.ll[Math.floor(g.ll.length / 2)];
      hasil.lat = bulat(t.lat); hasil.lon = bulat(t.lng);
    } else {
      hasil.luas = Math.round(luasPoligon(g.ll));
      hasil.panjang = Math.round(panjangGaris(g.ll.concat([g.ll[0]])));
      var pusat = L.polygon(g.ll).getBounds().getCenter();
      hasil.lat = bulat(pusat.lat); hasil.lon = bulat(pusat.lng);
    }
    return hasil;
  }

  // Hanya koordinat yang disimpan bersama rekaman.
  function terapkanKoordinat(rek) {
    var u = ukurGeometri(rek);
    rek.lat = u.lat;
    rek.lon = u.lon;
    return rek;
  }

  // Hasil ukur geometri langsung mengisi kolom luas atau panjang terdampak,
  // supaya pencatat tidak mengetik ulang angka yang sudah dihitung peta.
  // Angka yang diketik sendiri oleh pencatat tidak ditimpa: penimpaan hanya
  // terjadi kalau isiannya masih kosong atau masih berisi hasil ukur lama.
  function isiUkuranKeFormulir(rek) {
    if (!rek) return;
    var u = ukurGeometri(rek);

    function isi(selektor, nilai, kunci) {
      var el = $(selektor);
      if (!el || !nilai) return;
      var induk = el.closest('.par');
      if (induk && induk.classList.contains('sembunyi')) return;
      var sekarang = String(el.value || '').trim();
      if (sekarang === '' || sekarang === String(S.ukurOtomatis[kunci] || '')) {
        el.value = nilai;
        S.ukurOtomatis[kunci] = nilai;
      }
    }

    if (u.mode === 'area') {
      isi('#f_luas', u.luas, 'luas');            // keliling tidak diisikan,
                                                 // sebab bukan panjang terdampak
    } else if (u.mode === 'garis') {
      isi('#f_panjang', u.panjang, 'panjang');
    }
  }

  /* ------------------------------------------------------- sambungan data */

  function jsonp(url, params) {
    return new Promise(function (res, rej) {
      var cb = 'itdccb_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
      var s = document.createElement('script');
      var jatuhTempo = setTimeout(function () { bersih(); rej(new Error('waktu habis')); }, 25000);

      function bersih() {
        clearTimeout(jatuhTempo);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }

      window[cb] = function (data) { bersih(); res(data); };
      var q = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      s.src = url + (url.indexOf('?') === -1 ? '?' : '&') + q + '&callback=' + cb;
      s.onerror = function () { bersih(); rej(new Error('gagal menghubungi spreadsheet')); };
      document.head.appendChild(s);
    });
  }

  function kirim(aksi, muatan) {
    var url = S.setelan.url;
    if (!url) return Promise.reject(new Error('URL Apps Script belum diisi'));
    var badan = JSON.stringify(Object.assign({ action: aksi }, muatan));
    // text/plain supaya tidak memicu preflight CORS yang tidak dilayani Apps Script
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: badan,
      redirect: 'follow'
    }).then(function (r) { return r.json(); })
      .catch(function () {
        // sebagian jaringan memblokir pembacaan balasan; kirim tanpa baca balasan
        return fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: badan })
          .then(function () { return { ok: true, takPasti: true }; });
      });
  }

  function setStatus(st, teks) {
    var b = $('#statusSinkron');
    b.setAttribute('data-st', st);
    $('#statusTeks').textContent = teks;
  }

  function perbaruiStatus() {
    if (!S.setelan.url) { setStatus('luring', 'Mode lokal'); return; }
    if (S.sibuk) { setStatus('kerja', 'Menyinkronkan…'); return; }
    if (S.antrean.length) { setStatus('tunggu', S.antrean.length + ' menunggu'); return; }
    setStatus('ok', 'Tersimpan di Sheets');
  }

  /* ------------------------------------------------------ simpanan lokal */

  function simpanCache() {
    if (!S.kawasan) return;
    tulisLokal(KUNCI_CACHE + S.kawasan.id, Object.keys(S.rekaman).map(function (k) { return S.rekaman[k]; }));
  }

  function simpanAntrean() { tulisLokal(KUNCI_ANTREAN, S.antrean); }

  function antreankan(aksi, rek) {
    S.antrean = S.antrean.filter(function (a) { return !(a.uid === rek.uid && a.aksi === aksi); });
    S.antrean.push({ aksi: aksi, uid: rek.uid, data: rek, waktu: Date.now() });
    simpanAntrean();
    perbaruiStatus();
    prosesAntrean();
  }

  function prosesAntrean() {
    if (S.sibuk || !S.antrean.length || !S.setelan.url) { perbaruiStatus(); return; }
    S.sibuk = true;
    perbaruiStatus();
    var tugas = S.antrean[0];
    var janji = tugas.aksi === 'hapus'
      ? kirim('hapus', { uid: tugas.uid, pencatat: S.setelan.pencatat })
      : kirim('simpan', { data: tugas.data });

    janji.then(function (b) {
      if (b && b.ok === false) throw new Error(b.pesan || 'ditolak server');
      if (b && b.kode && S.rekaman[tugas.uid]) {
        S.rekaman[tugas.uid].kode = b.kode;
        S.rekaman[tugas.uid].tersinkron = true;
        simpanCache();
        gambarDaftar();
      } else if (S.rekaman[tugas.uid]) {
        S.rekaman[tugas.uid].tersinkron = true;
        simpanCache();
      }
      S.antrean.shift();
      simpanAntrean();
      S.sibuk = false;
      if (S.antrean.length) prosesAntrean(); else perbaruiStatus();
    }).catch(function (e) {
      S.sibuk = false;
      setStatus('tunggu', S.antrean.length + ' menunggu');
      console.warn('Sinkron tertunda:', e.message);
    });
  }

  function muatDariServer() {
    if (!S.setelan.url || !S.kawasan) return Promise.resolve();
    S.sibuk = true; perbaruiStatus();
    return jsonp(S.setelan.url, { action: 'list', kawasan: S.kawasan.id })
      .then(function (b) {
        S.sibuk = false;
        if (!b || !b.ok) throw new Error((b && b.pesan) || 'balasan tidak sah');
        var antreUid = {};
        S.antrean.forEach(function (a) { antreUid[a.uid] = true; });
        (b.data || []).forEach(function (r) {
          if (antreUid[r.uid]) return;             // perubahan lokal belum terkirim, jangan ditimpa
          r.tersinkron = true;
          S.rekaman[r.uid] = r;
        });
        simpanCache();
        gambarSemuaFitur();
        gambarDaftar();
        perbaruiStatus();
        toast('Memuat ' + (b.data || []).length + ' kejadian dari spreadsheet', 'ok');
      })
      .catch(function (e) {
        S.sibuk = false;
        setStatus('luring', 'Gagal memuat');
        toast('Tidak bisa memuat dari spreadsheet: ' + e.message, 'galat', 5000);
      });
  }

  /* ------------------------------------------------------------ peta inti */

  function buatPeta() {
    S.peta = L.map('peta', {
      zoomControl: false,
      attributionControl: true,
      doubleClickZoom: true,
      maxZoom: 21
    });

    L.control.zoom({ position: 'bottomright' }).addTo(S.peta);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(S.peta);

    S.dasar = {
      satelit: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 21, maxNativeZoom: 19,
        attribution: 'Citra: Esri, Maxar, Earthstar Geographics'
      }),
      jalan: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 21, maxNativeZoom: 19,
        attribution: '&copy; Kontributor OpenStreetMap'
      }),
      topo: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 21, maxNativeZoom: 19,
        attribution: 'Peta: Esri'
      })
    };

    var label = { satelit: 'Citra satelit', jalan: 'Peta jalan (OSM)', topo: 'Topografi' };
    var wadah = $('#pilihDasar');
    Object.keys(S.dasar).forEach(function (k) {
      var l = document.createElement('label');
      l.className = 'lapis-baris';
      l.innerHTML = '<input type="radio" name="dasar" value="' + k + '"' + (k === S.dasarAktif ? ' checked' : '') + ' /> ' + label[k];
      $('input', l).addEventListener('change', function () { gantiDasar(k); });
      wadah.appendChild(l);
    });

    S.dasar[S.dasarAktif].addTo(S.peta);
    S.grupFitur = L.layerGroup().addTo(S.peta);

    S.peta.on('click', saatKlikPeta);
    S.peta.on('mousemove', saatGerakPeta);
    S.peta.on('dblclick', function (e) {
      if (S.gambar && S.gambar.mode !== 'titik') {
        L.DomEvent.stop(e);
        selesaiGambar();
      }
    });
  }

  function gantiDasar(k) {
    if (!S.dasar[k]) return;
    S.peta.removeLayer(S.dasar[S.dasarAktif]);
    S.dasarAktif = k;
    S.dasar[k].addTo(S.peta);
    S.dasar[k].bringToBack();
  }

  function pasangLapisanKawasan() {
    [S.lapisBatas, S.lapisCitra, S.lapisZona].forEach(function (l) {
      if (l && S.peta.hasLayer(l)) S.peta.removeLayer(l);
    });
    S.lapisBatas = S.lapisCitra = S.lapisZona = null;

    var k = S.kawasan;

    S.lapisBatas = L.geoJSON(k.batas, {
      style: { color: '#15a0ab', weight: 2.5, opacity: .95, fill: false, dashArray: '7 5' },
      interactive: false
    });
    if ($('#lapisBatas').checked) S.lapisBatas.addTo(S.peta);

    if (k.basemap && k.basemap.image) {
      S.lapisCitra = L.imageOverlay(k.basemap.image, k.basemap.bounds, {
        opacity: Number($('#opasitasCitra').value) / 100,
        interactive: false
      });
      if ($('#lapisCitra').checked) S.lapisCitra.addTo(S.peta);
    }

    if (k.zona) {
      $('#barisZona').hidden = false;
      S.lapisZona = L.geoJSON(k.zona, {
        style: { color: '#c98b2e', weight: 1, opacity: .85, fillColor: '#c98b2e', fillOpacity: .10 },
        onEachFeature: function (f, l) {
          if (f.properties && f.properties.zona) l.bindTooltip('Zona ' + f.properties.zona, { sticky: true });
        }
      });
      if ($('#lapisZona').checked) S.lapisZona.addTo(S.peta);
    } else {
      $('#barisZona').hidden = true;
      $('#lapisZona').checked = false;
    }

    pasKawasan();
  }

  function pasKawasan() {
    if (!S.kawasan) return;
    var b = S.kawasan.bbox;
    S.peta.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [28, 28] });
  }

  /* ------------------------------------------------------- gambar fitur -- */

  // Warna cerah supaya terbaca di atas citra satelit, dengan lapis gelap
  // tipis di bawahnya supaya tetap terlihat di atas peta jalan yang terang.
  var GARIS_CERAH = '#ffd400';   // kuning, terbaca di atas citra maupun peta jalan

  function gayaFitur(rek, terpilih) {
    return {
      color: GARIS_CERAH,
      weight: terpilih ? 5.5 : 4,
      opacity: 1,
      fillColor: infoJenis(rek.jenis).warna,   // isian tetap mengikuti jenis
      fillOpacity: terpilih ? .34 : .22,
      dashArray: rek.tersinkron ? null : '7 5'
    };
  }

  function gayaBayangan(terpilih) {
    return {
      color: '#0b1b2b',
      weight: (terpilih ? 5.5 : 4) + 3,
      opacity: .45,
      fill: false,
      interactive: false
    };
  }

  function ikonTitik(rek, terpilih) {
    var j = infoJenis(rek.jenis);
    return L.divIcon({
      className: '',
      html: '<div class="penanda' + (terpilih ? ' terpilih' : '') + '" style="background:' + j.warna + '"><i>' + j.ikon + '</i></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 24],
      popupAnchor: [0, -22]
    });
  }

  function gambarFitur(rek) {
    if (S.lapisan[rek.uid]) {
      S.grupFitur.removeLayer(S.lapisan[rek.uid]);
      delete S.lapisan[rek.uid];
    }
    var g = dariGeoJSON(amanJSON(rek.geometry_geojson, null));
    if (!g.mode) return;
    var terpilih = S.terpilih === rek.uid;
    var lapis;

    if (g.mode === 'titik') {
      lapis = L.marker(g.ll[0], { icon: ikonTitik(rek, terpilih) });
    } else if (g.mode === 'garis') {
      lapis = L.featureGroup([
        L.polyline(g.ll, gayaBayangan(terpilih)),
        L.polyline(g.ll, gayaFitur(rek, terpilih))
      ]);
    } else {
      lapis = L.featureGroup([
        L.polygon(g.ll, gayaBayangan(terpilih)),
        L.polygon(g.ll, gayaFitur(rek, terpilih))
      ]);
    }

    lapis.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      if (S.gambar) return;
      pilihRekaman(rek.uid, false);
      bukaFormulir(rek);
    });

    lapis.bindTooltip(
      (rek.kode ? rek.kode + ' · ' : '') + (rek.jenis || 'Tanpa jenis') +
      (rek.lokasi ? ', ' + rek.lokasi : ''),
      { direction: 'top', offset: [0, g.mode === 'titik' ? -20 : 0] }
    );

    lapis.addTo(S.grupFitur);
    S.lapisan[rek.uid] = lapis;
  }

  function gambarSemuaFitur() {
    S.grupFitur.clearLayers();
    S.lapisan = {};
    Object.keys(S.rekaman).forEach(function (uid) { gambarFitur(S.rekaman[uid]); });
  }

  /* ---------------------------------------------------- mode menggambar -- */

  var PETUNJUK = {
    titik: 'Klik satu kali di peta untuk menandai lokasi kejadian.',
    garis: 'Klik berurutan mengikuti jalur terdampak. Klik ganda atau tombol <b>Selesai</b> untuk mengakhiri.',
    area: 'Klik membentuk batas area terdampak, minimal tiga titik. Klik ganda atau tombol <b>Selesai</b> untuk menutup area.'
  };

  function mulaiGambar(mode) {
    batalGambar();
    akhiriSunting();
    S.gambar = { mode: mode, titik: [], pratinjau: null, karet: null, simpul: [] };
    $$('.alat').forEach(function (b) { b.classList.toggle('aktif', b.dataset.alat === mode); });
    var p = $('#alatPetunjuk');
    p.innerHTML = PETUNJUK[mode];
    p.classList.add('tampil');
    $('#peta').style.cursor = 'crosshair';
    $('#gambarBar').classList.add('tampil');
    perbaruiBarGambar();
    tutupPanelMobil();
  }

  function perbaruiBarGambar() {
    if (!S.gambar) return;
    var n = S.gambar.titik.length;
    var teks = { titik: 'Menandai titik', garis: 'Menggambar garis', area: 'Menggambar area' }[S.gambar.mode];
    var ukur = '';
    if (S.gambar.mode === 'garis' && n > 1) ukur = ' · panjang ' + fmtPanjang(panjangGaris(S.gambar.titik));
    if (S.gambar.mode === 'area' && n > 2) ukur = ' · luas ' + fmtLuas(luasPoligon(S.gambar.titik));
    $('#gambarTeks').innerHTML = '<b>' + teks + '</b> · ' + n + ' titik' + ukur;
    $('#gambarSelesai').disabled = (S.gambar.mode === 'garis' && n < 2) || (S.gambar.mode === 'area' && n < 3);
    $('#gambarUndo').disabled = n === 0;
  }

  function perbaruiPratinjau() {
    var g = S.gambar;
    if (!g) return;
    if (g.pratinjau) { S.peta.removeLayer(g.pratinjau); g.pratinjau = null; }
    g.simpul.forEach(function (m) { S.peta.removeLayer(m); });
    g.simpul = [];

    if (g.titik.length) {
      if (g.mode === 'area' && g.titik.length > 2) {
        g.pratinjau = L.polygon(g.titik, { color: '#ffd400', weight: 3, dashArray: '6 4', fillColor: '#ffd400', fillOpacity: .18 }).addTo(S.peta);
      } else if (g.titik.length > 1) {
        g.pratinjau = L.polyline(g.titik, { color: '#ffd400', weight: 3, dashArray: '6 4' }).addTo(S.peta);
      }
      g.titik.forEach(function (p) {
        g.simpul.push(L.marker(p, {
          icon: L.divIcon({ className: '', html: '<div class="simpul"></div>', iconSize: [13, 13], iconAnchor: [6.5, 6.5] }),
          interactive: false
        }).addTo(S.peta));
      });
    }
    perbaruiBarGambar();
  }

  function saatKlikPeta(e) {
    if (!S.gambar) { return; }
    if (S.gambar.mode === 'titik') {
      S.gambar.titik = [e.latlng];
      selesaiGambar();
      return;
    }
    S.gambar.titik.push(e.latlng);
    perbaruiPratinjau();
  }

  function saatGerakPeta(e) {
    var g = S.gambar;
    if (!g || g.mode === 'titik' || !g.titik.length) return;
    var ujung = g.titik[g.titik.length - 1];
    if (!g.karet) {
      g.karet = L.polyline([ujung, e.latlng], { color: '#ffd400', weight: 2, dashArray: '4 5', opacity: .9, interactive: false }).addTo(S.peta);
    } else {
      g.karet.setLatLngs([ujung, e.latlng]);
    }
  }

  function undoTitik() {
    if (!S.gambar || !S.gambar.titik.length) return;
    S.gambar.titik.pop();
    perbaruiPratinjau();
  }

  function batalGambar() {
    var g = S.gambar;
    if (!g) return;
    if (g.pratinjau) S.peta.removeLayer(g.pratinjau);
    if (g.karet) S.peta.removeLayer(g.karet);
    g.simpul.forEach(function (m) { S.peta.removeLayer(m); });
    S.gambar = null;
    $$('.alat').forEach(function (b) { b.classList.remove('aktif'); });
    $('#alatPetunjuk').classList.remove('tampil');
    $('#peta').style.cursor = '';
    $('#gambarBar').classList.remove('tampil');
  }

  function selesaiGambar() {
    var g = S.gambar;
    if (!g) return;
    if (g.mode === 'garis' && g.titik.length < 2) { toast('Garis perlu minimal dua titik', 'galat'); return; }
    if (g.mode === 'area' && g.titik.length < 3) { toast('Area perlu minimal tiga titik', 'galat'); return; }

    var geom = keGeoJSON(g.mode, g.titik);
    var mode = g.mode;
    batalGambar();

    var rek = {
      uid: uidBaru(S.kawasan.kode),
      kode: '',
      kawasan: S.kawasan.id,
      tipe_geometri: { titik: 'Titik', garis: 'Garis', area: 'Area' }[mode],
      geometry_geojson: JSON.stringify(geom),
      jenis: '',
      tanggal_mulai: '',
      pencatat: S.setelan.pencatat || '',
      dibuat: new Date().toISOString(),
      tersinkron: false,
      baru: true
    };
    terapkanKoordinat(rek);
    S.draf = rek;
    bukaFormulir(rek);
  }

  /* -------------------------------------------------- sunting geometri -- */

  function mulaiSunting(uid) {
    akhiriSunting();
    var rek = S.rekaman[uid] || (S.draf && S.draf.uid === uid ? S.draf : null);
    if (!rek) return;
    var g = dariGeoJSON(amanJSON(rek.geometry_geojson, null));
    if (!g.mode) return;

    S.sunting = { uid: uid, mode: g.mode, titik: g.ll.slice(), simpul: [], lapis: null, asli: rek.geometry_geojson };
    gambarSuntingan();
    $('#gambarBar').classList.add('tampil');
    $('#gambarTeks').innerHTML = '<b>Mengubah geometri</b> · seret simpul, klik simpul tengah untuk menambah';
    $('#gambarUndo').disabled = true;
    $('#gambarSelesai').disabled = false;
    toast('Seret simpul untuk memindahkan. Tekan Selesai bila sudah pas.', 'info', 4200);
  }

  function gambarSuntingan() {
    var s = S.sunting;
    if (!s) return;
    if (s.lapis) S.peta.removeLayer(s.lapis);
    s.simpul.forEach(function (m) { S.peta.removeLayer(m); });
    s.simpul = [];

    if (s.mode === 'garis') s.lapis = L.polyline(s.titik, { color: '#ffd400', weight: 4, dashArray: '6 4' }).addTo(S.peta);
    if (s.mode === 'area') s.lapis = L.polygon(s.titik, { color: '#ffd400', weight: 4, dashArray: '6 4', fillColor: '#ffd400', fillOpacity: .18 }).addTo(S.peta);

    s.titik.forEach(function (p, i) {
      var m = L.marker(p, {
        draggable: true,
        icon: L.divIcon({ className: '', html: '<div class="simpul"></div>', iconSize: [15, 15], iconAnchor: [7.5, 7.5] })
      }).addTo(S.peta);
      m.on('drag', function (e) {
        s.titik[i] = e.target.getLatLng();
        if (s.lapis) s.lapis.setLatLngs(s.titik);
      });
      m.on('dragend', perbaruiUkuranSunting);
      m.on('contextmenu', function () {
        if (s.mode === 'titik') return;
        var min = s.mode === 'garis' ? 2 : 3;
        if (s.titik.length <= min) { toast('Simpul sudah minimum', 'galat'); return; }
        s.titik.splice(i, 1);
        gambarSuntingan();
      });
      s.simpul.push(m);
    });

    if (s.mode !== 'titik') {
      var n = s.titik.length;
      var batas = s.mode === 'area' ? n : n - 1;
      for (var i = 0; i < batas; i++) {
        (function (i) {
          var a = s.titik[i], b = s.titik[(i + 1) % n];
          var tengah = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
          var m = L.marker(tengah, {
            icon: L.divIcon({ className: '', html: '<div class="simpul tengah"></div>', iconSize: [11, 11], iconAnchor: [5.5, 5.5] })
          }).addTo(S.peta);
          m.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            s.titik.splice(i + 1, 0, tengah);
            gambarSuntingan();
            perbaruiUkuranSunting();
          });
          s.simpul.push(m);
        })(i);
      }
    }
  }

  function perbaruiUkuranSunting() {
    var s = S.sunting;
    if (!s) return;
    var rek = S.draf && S.draf.uid === s.uid ? S.draf : S.rekaman[s.uid];
    if (!rek) return;
    rek.geometry_geojson = JSON.stringify(keGeoJSON(s.mode, s.titik));
    terapkanKoordinat(rek);
    isiUkuran(rek);
    isiUkuranKeFormulir(rek);
  }

  function akhiriSunting(simpan) {
    var s = S.sunting;
    if (!s) return;
    var rek = S.draf && S.draf.uid === s.uid ? S.draf : S.rekaman[s.uid];
    if (simpan) {
      perbaruiUkuranSunting();
    } else if (rek && s.asli) {
      rek.geometry_geojson = s.asli;          // batal: kembalikan bentuk semula
      terapkanKoordinat(rek);
      isiUkuran(rek);
    }
    if (s.lapis) S.peta.removeLayer(s.lapis);
    s.simpul.forEach(function (m) { S.peta.removeLayer(m); });
    S.sunting = null;
    $('#gambarBar').classList.remove('tampil');
    if (rek) gambarFitur(rek);
  }

  /* ------------------------------------------------------------ formulir */

  function isiPilihanJenis() {
    var sel = $('#f_jenis');
    var saring = $('#saringJenis');
    sel.innerHTML = '<option value="">Belum dipilih</option>';
    saring.innerHTML = '<option value="">Semua jenis</option>';

    var grup = {};
    JENIS.forEach(function (j) {
      var kunci = j.kelas || 'lain';
      if (!grup[kunci]) {
        grup[kunci] = { sel: document.createElement('optgroup'), saring: document.createElement('optgroup') };
        var judul = NAMA_KELAS[j.kelas] || 'Lainnya';
        grup[kunci].sel.label = judul;
        grup[kunci].saring.label = judul;
        sel.appendChild(grup[kunci].sel);
        saring.appendChild(grup[kunci].saring);
      }
      var o = document.createElement('option');
      o.value = o.textContent = j.nama;
      grup[kunci].sel.appendChild(o);
      grup[kunci].saring.appendChild(o.cloneNode(true));
    });

    isiPilihanWaktu();

    var grid = $('#dampakGrid');
    grid.innerHTML = '';
    DAMPAK.forEach(function (d, i) {
      var l = document.createElement('label');
      l.className = 'centang';
      l.innerHTML = '<input type="checkbox" value="" id="dmp' + i + '" /> <span></span>';
      $('input', l).value = d;
      $('span', l).textContent = d;
      $('input', l).addEventListener('change', function () { l.classList.toggle('pilih', this.checked); });
      grid.appendChild(l);
    });
  }

  // Parameter fisik mengikuti jenis kejadian. Isian yang tidak relevan
  // disembunyikan supaya pencatat tidak perlu memilah sendiri, dan selama
  // jenis belum dipilih tidak ada isian yang ditampilkan.
  function isiPilihanWaktu() {
    var thn = $('#f_tahun');
    var sekarang = new Date().getFullYear();
    thn.innerHTML = '<option value="">Tidak diingat</option>';
    for (var y = sekarang; y >= 1990; y--) {
      var o = document.createElement('option');
      o.value = o.textContent = String(y);
      thn.appendChild(o);
    }

    var bln = $('#f_bulan');
    bln.innerHTML = '<option value="">Tidak diingat</option>';
    BULAN.forEach(function (b) {
      var o = document.createElement('option');
      o.value = o.textContent = b;
      bln.appendChild(o);
    });

    var msm = $('#f_musim');
    msm.innerHTML = '<option value="">Tidak diingat</option>';
    MUSIM.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.nilai;
      o.textContent = m.label;
      msm.appendChild(o);
    });
  }

  // Tanggal persis, bulan, dan musim saling melengkapi. Begitu salah satunya
  // diisi, isian yang bisa disimpulkan darinya ikut terisi, supaya pencatat
  // tidak mengisi hal yang sama dua kali.
  function rapikanWaktu(sumber) {
    var tgl = $('#f_tanggal_mulai').value;

    if (sumber === 'tanggal' && tgl) {
      var d = new Date(tgl + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        $('#f_tahun').value = String(d.getFullYear());
        $('#f_bulan').value = BULAN[d.getMonth()];
        if (!$('#f_musim').value) $('#f_musim').value = MUSIM_BULAN[d.getMonth()];
      }
      return;
    }

    if (sumber === 'bulan') {
      var i = BULAN.indexOf($('#f_bulan').value);
      if (i >= 0 && !$('#f_musim').value) $('#f_musim').value = MUSIM_BULAN[i];
    }
  }

  function sesuaikanParameter(kosongkanTersembunyi) {
    var jenis = $('#f_jenis').value;
    var relevan = jenis ? infoJenis(jenis).par : [];
    var semua = jenis === 'Lainnya';
    var jumlahTampil = 0;

    $$('.par').forEach(function (d) {
      var tampil = !!jenis && (semua || relevan.indexOf(d.dataset.par) !== -1);
      d.classList.toggle('sembunyi', !tampil);
      if (tampil) {
        jumlahTampil++;
      } else if (kosongkanTersembunyi) {
        var isian = $('input', d);
        if (isian) isian.value = '';
      }
    });

    // jenis tanpa parameter fisik, misalnya suhu ekstrem: seluruh blok ditutup
    var ket = $('#ketKelas');
    var kelas = jenis ? infoJenis(jenis).kelas : '';
    ket.textContent = kelas
      ? NAMA_KELAS[kelas] + (kelas === 'akut'
          ? ', kejadian mendadak dengan dampak langsung'
          : ', perubahan bertahap yang dampaknya menumpuk')
      : '';
    ket.classList.toggle('sembunyi', !kelas);

    $('#blokParameter').classList.toggle('sembunyi', !!jenis && jumlahTampil === 0);
    $('#parameterKosong').classList.toggle('sembunyi', !!jenis);
    $('#bungkusJenisLain').classList.toggle('sembunyi', jenis !== 'Lainnya');

    isiUkuranKeFormulir(S.draf);
  }

  function isiUkuran(rek) {
    var k = $('#ukurKotak');
    var u = ukurGeometri(rek);
    var bagian = [];
    bagian.push(['Tipe geometri', rek.tipe_geometri || 'belum ada']);
    if (u.panjang) bagian.push(['Panjang terukur', fmtPanjang(u.panjang)]);
    if (u.luas) bagian.push(['Luas terukur', fmtLuas(u.luas)]);
    if (u.lat !== '') {
      bagian.push(['Koordinat', Number(u.lat).toFixed(5) + ', ' + Number(u.lon).toFixed(5)]);
    }
    k.innerHTML = bagian.map(function (b) {
      return '<div class="ukur-item"><span class="k">' + b[0] + '</span><span class="v"></span></div>';
    }).join('');
    $$('.ukur-item .v', k).forEach(function (sp, i) { sp.textContent = bagian[i][1]; });
  }

  function bukaFormulir(rek) {
    S.draf = rek;
    S.ukurOtomatis = {};
    var baru = !!rek.baru;
    $('#drawerJudul').textContent = baru ? 'Kejadian baru' : (rek.kode || 'Kejadian');
    $('#drawerSub').textContent = S.kawasan.nama + ' · ' + (rek.tipe_geometri || 'geometri kosong') +
      ' · ' + (baru ? 'belum tersimpan' : (rek.tersinkron ? 'tersimpan' : 'menunggu sinkron'));
    $('#tombolHapus').classList.toggle('sembunyi', baru);

    MEDAN.forEach(function (m) {
      var el = $('[name="' + m + '"]');
      if (el) el.value = rek[m] === undefined || rek[m] === null ? '' : rek[m];
    });
    if (!rek.pencatat && S.setelan.pencatat) $('#f_pencatat').value = S.setelan.pencatat;

    var dipilih = String(rek.dampak || '').split(';').map(function (s) { return s.trim(); });
    $$('#dampakGrid .centang').forEach(function (l) {
      var cb = $('input', l);
      cb.checked = dipilih.indexOf(cb.value) !== -1;
      l.classList.toggle('pilih', cb.checked);
    });

    sesuaikanParameter();
    isiUkuran(rek);
    $('#drawer').classList.add('buka');
    pilihRekaman(rek.uid, false);
  }

  function tutupFormulir() {
    $('#drawer').classList.remove('buka');
    akhiriSunting();
    if (S.draf && S.draf.baru) {
      // batal: fitur belum tersimpan, bersihkan dari peta
      if (S.lapisan[S.draf.uid]) { S.grupFitur.removeLayer(S.lapisan[S.draf.uid]); delete S.lapisan[S.draf.uid]; }
    }
    S.draf = null;
    pilihRekaman(null, false);
  }

  function bacaFormulir(rek) {
    MEDAN.forEach(function (m) {
      var el = $('[name="' + m + '"]');
      if (!el) return;
      var v = el.value;
      if (el.type === 'number') v = angka(v);
      rek[m] = v;
    });
    rek.dampak = $$('#dampakGrid input:checked').map(function (c) { return c.value; }).join('; ');
    return rek;
  }

  function simpanKejadian() {
    if (!S.draf) return;
    if (!$('#f_jenis').value) { toast('Jenis kejadian wajib dipilih', 'galat'); $('#f_jenis').focus(); return; }

    var rek = bacaFormulir(S.draf);
    rek.kelas_bahaya = NAMA_KELAS[infoJenis(rek.jenis).kelas] || '';
    delete rek.baru;
    rek.tersinkron = false;
    rek.diperbarui = new Date().toISOString();
    terapkanKoordinat(rek);

    S.rekaman[rek.uid] = rek;
    simpanCache();
    gambarFitur(rek);
    gambarDaftar();

    if (S.setelan.url) {
      antreankan('simpan', salinBersih(rek));
      toast('Kejadian disimpan, sedang dikirim ke spreadsheet', 'ok');
    } else {
      toast('Kejadian disimpan di browser. Isi URL Apps Script untuk menyimpan ke spreadsheet.', 'info', 5000);
      perbaruiStatus();
    }

    $('#drawer').classList.remove('buka');
    akhiriSunting();
    S.draf = null;
  }

  function salinBersih(rek) {
    var s = Object.assign({}, rek);
    delete s.tersinkron;
    delete s.baru;
    return s;
  }

  function hapusKejadian() {
    if (!S.draf || S.draf.baru) return;
    var rek = S.draf;
    konfirmasi('Hapus kejadian', 'Kejadian ' + (rek.kode || '') + ' akan ditandai terhapus di spreadsheet. Lanjutkan?', function () {
      if (S.lapisan[rek.uid]) { S.grupFitur.removeLayer(S.lapisan[rek.uid]); delete S.lapisan[rek.uid]; }
      delete S.rekaman[rek.uid];
      simpanCache();
      gambarDaftar();
      $('#drawer').classList.remove('buka');
      S.draf = null;
      if (S.setelan.url) antreankan('hapus', { uid: rek.uid });
      toast('Kejadian dihapus', 'ok');
    });
  }

  /* --------------------------------------------------------------- daftar */

  function rekamanTersaring() {
    var q = $('#cari').value.trim().toLowerCase();
    var j = $('#saringJenis').value;
    return Object.keys(S.rekaman).map(function (k) { return S.rekaman[k]; })
      .filter(function (r) {
        if (j && r.jenis !== j) return false;
        if (!q) return true;
        return [r.kode, r.jenis, r.lokasi, r.aset_terdampak, r.catatan, r.pencatat, r.penanganan]
          .join(' ').toLowerCase().indexOf(q) !== -1;
      })
      .sort(function (a, b) {
        var ta = kunciWaktu(a), tb = kunciWaktu(b);
        if (!ta && !tb) return String(b.dibuat || '').localeCompare(String(a.dibuat || ''));
        if (!ta) return 1;          // tanpa tanggal diletakkan paling bawah
        if (!tb) return -1;
        return tb.localeCompare(ta);
      });
  }

  function kelasKeparahan(k) {
    if (k === 'Ringan') return 'ringan';
    if (k === 'Sedang') return 'sedang';
    if (k === 'Berat') return 'berat';
    if (k === 'Sangat berat') return 'sangat';
    return 'belum';
  }

  function gambarDaftar() {
    var daftar = rekamanTersaring();
    var wadah = $('#daftar');
    $('#hitungDaftar').textContent = daftar.length + (Object.keys(S.rekaman).length !== daftar.length ? ' / ' + Object.keys(S.rekaman).length : '');
    wadah.innerHTML = '';

    if (!daftar.length) {
      wadah.innerHTML = '<div class="kosong">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3Z"/><path d="M9 7v13M15 4v13"/></svg>' +
        '<p>Belum ada kejadian tercatat</p><small>Pakai alat Titik, Garis, atau Area di atas untuk menandai kejadian pertama.</small></div>';
      return;
    }

    daftar.forEach(function (r) {
      var j = infoJenis(r.jenis);
      var d = document.createElement('div');
      d.className = 'butir' + (S.terpilih === r.uid ? ' pilih' : '');
      d.innerHTML =
        '<span class="butir-pita" style="background:' + j.warna + '"></span>' +
        '<div class="butir-isi">' +
          '<div class="butir-kode"><span class="kd"></span>' + (r.tersinkron ? '' : '<span title="menunggu sinkron">•</span>') + '</div>' +
          '<div class="butir-nama"></div>' +
          '<div class="butir-meta"><span class="tgl"></span><span class="lok"></span></div>' +
        '</div>' +
        '<div class="butir-aksi"><span class="lencana ' + kelasKeparahan(r.keparahan) + '"></span></div>';

      $('.kd', d).textContent = (r.kode || 'BARU') + ' · ' + (r.tipe_geometri || '');
      $('.butir-nama', d).textContent = r.jenis || 'Jenis belum diisi';
      $('.tgl', d).textContent = teksWaktu(r);
      $('.lok', d).textContent = r.lokasi || '';
      $('.lencana', d).textContent = r.keparahan || 'belum dinilai';

      d.addEventListener('click', function () {
        pilihRekaman(r.uid, true);
        bukaFormulir(S.rekaman[r.uid]);
      });
      wadah.appendChild(d);
    });
  }

  function pilihRekaman(uid, zoom) {
    var lama = S.terpilih;
    S.terpilih = uid;
    [lama, uid].forEach(function (u) { if (u && S.rekaman[u]) gambarFitur(S.rekaman[u]); });
    if (uid && S.draf && S.draf.uid === uid && S.draf.baru) gambarFitur(S.draf);
    gambarDaftar();

    if (zoom && uid && S.lapisan[uid]) {
      var l = S.lapisan[uid];
      if (l.getBounds) S.peta.fitBounds(l.getBounds(), { padding: [60, 60], maxZoom: 18 });
      else S.peta.setView(l.getLatLng(), Math.max(S.peta.getZoom(), 17));
      tutupPanelMobil();
    }
  }

  /* ---------------------------------------------------------------- unduh */

  function unduhBerkas(nama, isi, tipe) {
    var blob = new Blob([isi], { type: tipe || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nama;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function kumpulanUnduh() {
    var lingkup = $('#unduhLingkup').value;
    if (lingkup === 'kawasan') {
      return Object.keys(S.rekaman).map(function (k) { return S.rekaman[k]; });
    }
    var semua = [];
    Object.keys(S.semuaKawasan).forEach(function (id) {
      if (id === S.kawasan.id) {
        semua = semua.concat(Object.keys(S.rekaman).map(function (k) { return S.rekaman[k]; }));
      } else {
        semua = semua.concat(bacaLokal(KUNCI_CACHE + id, []));
      }
    });
    return semua;
  }

  function keFiturGeoJSON(daftar) {
    return {
      type: 'FeatureCollection',
      name: 'kejadian_bencana_itdc',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: daftar.map(function (r) {
        var sifat = {};
        ['kode', 'uid', 'kawasan', 'jenis', 'jenis_lain', 'kelas_bahaya', 'tahun', 'bulan', 'musim', 'tanggal_mulai', 'tanggal_selesai',
          'lama_jam', 'keparahan', 'lokasi', 'aset_terdampak', 'dampak', 'kedalaman_cm',
          'tinggi_gelombang_m', 'panjang_terdampak_m', 'luas_terdampak_m2', 'kerugian_rp',
          'biaya_penanganan_rp', 'penanganan', 'sumber', 'sumber_detail',
          'pencatat', 'catatan', 'tipe_geometri', 'lat', 'lon',
          'dibuat', 'diperbarui'].forEach(function (k) {
            sifat[k] = r[k] === undefined ? '' : r[k];
          });
        return { type: 'Feature', properties: sifat, geometry: amanJSON(r.geometry_geojson, null) };
      })
    };
  }

  function barisTabel(daftar) {
    var kolom = ['kode', 'kawasan', 'jenis', 'jenis_lain', 'kelas_bahaya', 'tahun', 'bulan', 'musim', 'tanggal_mulai', 'tanggal_selesai',
      'lama_jam', 'keparahan', 'lokasi', 'aset_terdampak', 'dampak', 'kedalaman_cm',
      'tinggi_gelombang_m', 'panjang_terdampak_m', 'luas_terdampak_m2', 'kerugian_rp',
      'biaya_penanganan_rp', 'penanganan', 'sumber', 'sumber_detail', 'pencatat',
      'catatan', 'tipe_geometri', 'lat', 'lon', 'geometry_geojson',
      'uid', 'dibuat', 'diperbarui'];
    return { kolom: kolom, baris: daftar.map(function (r) {
      return kolom.map(function (k) { return r[k] === undefined || r[k] === null ? '' : r[k]; });
    }) };
  }

  function unduh(format) {
    var daftar = kumpulanUnduh();
    if (!daftar.length) { toast('Belum ada data untuk diunduh', 'galat'); return; }
    var cap = 'kejadian_bencana_' + ($('#unduhLingkup').value === 'kawasan' ? S.kawasan.id : 'semua') +
      '_' + hariIni();

    if (format === 'geojson') {
      unduhBerkas(cap + '.geojson', JSON.stringify(keFiturGeoJSON(daftar), null, 1), 'application/geo+json');
      toast('GeoJSON diunduh (' + daftar.length + ' fitur)', 'ok');
      return;
    }

    var t = barisTabel(daftar);

    if (format === 'csv') {
      var baris = [t.kolom].concat(t.baris).map(function (r) {
        return r.map(function (sel) {
          var s = String(sel).replace(/"/g, '""');
          return /[",\n;]/.test(s) ? '"' + s + '"' : s;
        }).join(',');
      }).join('\r\n');
      unduhBerkas(cap + '.csv', '﻿' + baris, 'text/csv;charset=utf-8');
      toast('CSV diunduh (' + daftar.length + ' baris)', 'ok');
      return;
    }

    muatSheetJS().then(function () {
      var wb = XLSX.utils.book_new();
      var ws = XLSX.utils.aoa_to_sheet([t.kolom].concat(t.baris));
      ws['!cols'] = t.kolom.map(function (k) { return { wch: Math.min(Math.max(k.length + 2, 12), 40) }; });
      XLSX.utils.book_append_sheet(wb, ws, 'Kejadian');
      XLSX.writeFile(wb, cap + '.xlsx');
      toast('Excel diunduh (' + daftar.length + ' baris)', 'ok');
    }).catch(function () {
      toast('Pustaka Excel gagal dimuat, pakai unduhan CSV', 'galat');
    });
  }

  function muatSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  /* ------------------------------------------------------------- kawasan */

  function gambarKartuKawasan() {
    var wadah = $('#kartuKawasan');
    wadah.innerHTML = '';
    Object.keys(S.semuaKawasan).forEach(function (id) {
      var k = S.semuaKawasan[id];
      var n = bacaLokal(KUNCI_CACHE + id, []).length;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'kartu-kawasan';
      b.innerHTML =
        '<div class="kartu-gambar" style="background-image:url(\'' + k.basemap.image + '\')"></div>' +
        '<div class="kartu-isi"><h2></h2><span class="prov"></span><span class="jml"></span></div>';
      $('h2', b).textContent = k.nama;
      $('.prov', b).textContent = k.provinsi;
      $('.jml', b).textContent = n ? n + ' kejadian tersimpan di perangkat ini' : 'Belum ada catatan lokal';
      b.addEventListener('click', function () { bukaKawasan(id); });
      wadah.appendChild(b);
    });
  }

  function bukaKawasan(id) {
    S.kawasan = S.semuaKawasan[id];
    S.rekaman = {};
    S.terpilih = null;
    S.draf = null;

    bacaLokal(KUNCI_CACHE + id, []).forEach(function (r) { S.rekaman[r.uid] = r; });

    $('#pemilih').style.display = 'none';
    $('#app').classList.add('tampil');
    $('#namaKawasan').textContent = S.kawasan.nama;
    document.title = 'Kejadian Bencana ' + S.kawasan.nama + ' · ITDC';

    if (!S.peta) buatPeta();
    S.peta.invalidateSize();
    pasangLapisanKawasan();
    gambarSemuaFitur();
    gambarDaftar();
    perbaruiStatus();

    try { localStorage.setItem('itdc_bencana_terakhir', id); } catch (e) {}

    if (S.setelan.url && (!window.KONFIG || window.KONFIG.MUAT_OTOMATIS !== false)) muatDariServer();
    setTimeout(function () { S.peta.invalidateSize(); }, 220);
  }

  function kembaliKePemilih() {
    batalGambar();
    akhiriSunting();
    $('#drawer').classList.remove('buka');
    $('#app').classList.remove('tampil');
    $('#pemilih').style.display = 'grid';
    gambarKartuKawasan();
  }

  /* ------------------------------------------------------------ pengaturan */

  function muatSetelan() {
    var tersimpan = bacaLokal(KUNCI_SETELAN, null);
    var K = window.KONFIG || {};
    S.setelan.url = (tersimpan && tersimpan.url) || K.URL_APPS_SCRIPT || '';
    S.setelan.pencatat = (tersimpan && tersimpan.pencatat) || K.PENCATAT_BAWAAN || '';
    S.antrean = bacaLokal(KUNCI_ANTREAN, []);
  }

  function bukaPengaturan() {
    $('#setUrl').value = S.setelan.url;
    $('#setPencatat').value = S.setelan.pencatat;
    $('#infoSambungan').textContent = S.setelan.url
      ? 'Tersambung ke: ' + S.setelan.url
      : 'Belum tersambung. Tanpa URL, data hanya tersimpan di browser ini.';
    $('#tiraiPengaturan').classList.add('buka');
  }

  function simpanPengaturan() {
    S.setelan.url = $('#setUrl').value.trim();
    S.setelan.pencatat = $('#setPencatat').value.trim();
    tulisLokal(KUNCI_SETELAN, S.setelan);
    $('#tiraiPengaturan').classList.remove('buka');
    perbaruiStatus();
    toast('Pengaturan disimpan', 'ok');
    if (S.setelan.url) {
      prosesAntrean();
      if (S.kawasan) muatDariServer();
    }
  }

  function ujiSambungan() {
    var url = $('#setUrl').value.trim();
    if (!url) { toast('Isi URL Apps Script dulu', 'galat'); return; }
    $('#infoSambungan').textContent = 'Menguji sambungan…';
    jsonp(url, { action: 'ping' }).then(function (b) {
      $('#infoSambungan').textContent = b && b.ok
        ? 'Berhasil tersambung ke spreadsheet: ' + (b.spreadsheet || '(tanpa nama)')
        : 'Balasan tidak dikenali: ' + JSON.stringify(b).slice(0, 180);
    }).catch(function (e) {
      $('#infoSambungan').textContent = 'Gagal: ' + e.message +
        '. Pastikan deployment Web App diatur "Anyone" dan URL berakhiran /exec.';
    });
  }

  /* ---------------------------------------------------------------- tema */

  function terapkanTema(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(KUNCI_TEMA, t); } catch (e) {}
  }

  /* ------------------------------------------------------------ mobil ---- */

  function tutupPanelMobil() {
    if (window.innerWidth <= 960) $('#panel').classList.remove('buka');
  }

  /* --------------------------------------------------------------- pasang */

  function pasangPeristiwa() {
    $$('.alat').forEach(function (b) {
      b.addEventListener('click', function () {
        if (S.gambar && S.gambar.mode === b.dataset.alat) batalGambar();
        else mulaiGambar(b.dataset.alat);
      });
    });

    $('#gambarBatal').addEventListener('click', function () {
      if (S.sunting) akhiriSunting(false); else batalGambar();
    });
    $('#gambarUndo').addEventListener('click', undoTitik);
    $('#gambarSelesai').addEventListener('click', function () {
      if (S.sunting) {
        akhiriSunting(true);
        toast('Geometri diperbarui, jangan lupa Simpan kejadian', 'info');
      } else selesaiGambar();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (S.gambar) { batalGambar(); return; }
        if (S.sunting) { akhiriSunting(false); return; }
        if ($('.tirai.buka')) { $('.tirai.buka').classList.remove('buka'); return; }
        if ($('#drawer').classList.contains('buka')) tutupFormulir();
      }
      if (S.gambar && S.gambar.mode !== 'titik') {
        if (e.key === 'Enter') { e.preventDefault(); selesaiGambar(); }
        if (e.key === 'Backspace' && document.activeElement === document.body) { e.preventDefault(); undoTitik(); }
      }
    });

    $('#cari').addEventListener('input', gambarDaftar);
    $('#saringJenis').addEventListener('change', gambarDaftar);

    $('#f_jenis').addEventListener('change', function () {
      sesuaikanParameter(true);
      if (S.draf) { S.draf.jenis = this.value; gambarFitur(S.draf); }
    });

    $('#f_tanggal_mulai').addEventListener('change', function () { rapikanWaktu('tanggal'); });
    $('#f_bulan').addEventListener('change', function () { rapikanWaktu('bulan'); });

    $('#drawerTutup').addEventListener('click', tutupFormulir);
    $('#tombolSimpan').addEventListener('click', simpanKejadian);
    $('#tombolHapus').addEventListener('click', hapusKejadian);
    $('#tombolUbahGeometri').addEventListener('click', function () {
      if (S.draf) mulaiSunting(S.draf.uid);
    });

    $('#lapisBatas').addEventListener('change', function () {
      if (!S.lapisBatas) return;
      this.checked ? S.lapisBatas.addTo(S.peta) : S.peta.removeLayer(S.lapisBatas);
    });
    $('#lapisCitra').addEventListener('change', function () {
      if (!S.lapisCitra) return;
      this.checked ? S.lapisCitra.addTo(S.peta) : S.peta.removeLayer(S.lapisCitra);
    });
    $('#lapisZona').addEventListener('change', function () {
      if (!S.lapisZona) return;
      this.checked ? S.lapisZona.addTo(S.peta) : S.peta.removeLayer(S.lapisZona);
    });
    $('#opasitasCitra').addEventListener('input', function () {
      $('#opasitasNilai').textContent = this.value + '%';
      if (S.lapisCitra) S.lapisCitra.setOpacity(Number(this.value) / 100);
    });

    $('#tombolPasKawasan').addEventListener('click', pasKawasan);
    $('#tombolLokasiSaya').addEventListener('click', function () {
      if (!navigator.geolocation) { toast('Perangkat tidak mendukung GPS', 'galat'); return; }
      toast('Mencari lokasi…', 'info', 2000);
      navigator.geolocation.getCurrentPosition(function (p) {
        var ll = L.latLng(p.coords.latitude, p.coords.longitude);
        S.peta.setView(ll, 18);
        L.circleMarker(ll, { radius: 7, color: '#15a0ab', fillColor: '#15a0ab', fillOpacity: .6 })
          .addTo(S.peta).bindTooltip('Posisi Anda (±' + Math.round(p.coords.accuracy) + ' m)').openTooltip();
      }, function () {
        toast('Lokasi tidak bisa diambil. Pastikan izin lokasi aktif dan situs dibuka lewat HTTPS.', 'galat', 5000);
      }, { enableHighAccuracy: true, timeout: 12000 });
    });

    $('#tombolKawasan').addEventListener('click', kembaliKePemilih);
    $('#tombolPanel').addEventListener('click', function () { $('#panel').classList.toggle('buka'); });
    $('#tombolPengaturan').addEventListener('click', bukaPengaturan);
    $('#bukaPengaturanAwal').addEventListener('click', bukaPengaturan);
    $('#simpanPengaturan').addEventListener('click', simpanPengaturan);
    $('#ujiSambungan').addEventListener('click', ujiSambungan);
    $('#konfirmasiBatal').addEventListener('click', function () { $('#tiraiKonfirmasi').classList.remove('buka'); });

    $('#tombolUnduh').addEventListener('click', function () { $('#tiraiUnduh').classList.add('buka'); });
    $$('[data-unduh]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#tiraiUnduh').classList.remove('buka');
        unduh(b.dataset.unduh);
      });
    });
    $$('[data-tutup]').forEach(function (b) {
      b.addEventListener('click', function () { $('#' + b.dataset.tutup).classList.remove('buka'); });
    });
    $$('.tirai').forEach(function (t) {
      t.addEventListener('click', function (e) { if (e.target === t) t.classList.remove('buka'); });
    });

    $('#tombolSinkron').addEventListener('click', function () {
      if (!S.setelan.url) { bukaPengaturan(); return; }
      prosesAntrean();
      muatDariServer();
    });
    $('#statusSinkron').addEventListener('click', function () {
      if (!S.setelan.url) bukaPengaturan(); else prosesAntrean();
    });

    $('#tombolTema').addEventListener('click', function () {
      var skr = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      terapkanTema(skr);
    });

    window.addEventListener('online', function () { if (S.antrean.length) prosesAntrean(); });
    window.addEventListener('beforeunload', function (e) {
      if (S.antrean.length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ----------------------------------------------------------------- mula */

  function mula() {
    try {
      var t = localStorage.getItem(KUNCI_TEMA);
      if (t) document.documentElement.setAttribute('data-theme', t);
      else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } catch (e) {}

    muatSetelan();
    isiPilihanJenis();
    pasangPeristiwa();

    fetch('data/kawasan.json')
      .then(function (r) {
        if (!r.ok) throw new Error('kawasan.json tidak terbaca (' + r.status + ')');
        return r.json();
      })
      .then(function (data) {
        S.semuaKawasan = data;
        gambarKartuKawasan();
        $('#statusSumber').textContent = S.setelan.url
          ? 'Tersambung ke spreadsheet Google'
          : 'Belum tersambung ke spreadsheet, data tersimpan sementara di browser';
        if (S.antrean.length) prosesAntrean();
      })
      .catch(function (e) {
        $('#statusSumber').textContent = 'Gagal memuat data kawasan: ' + e.message +
          '. Jalankan situs lewat server (bukan klik berkas langsung).';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mula);
  else mula();
})();
