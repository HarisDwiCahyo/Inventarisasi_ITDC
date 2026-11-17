/**
 * Backend Inventarisasi Kejadian Bencana Kawasan ITDC
 * Spreadsheet Google Sheets dipakai sebagai basis data.
 *
 * Cara pasang (sekali saja):
 *  1. Buat Google Spreadsheet baru, beri nama misal "Inventarisasi Bencana ITDC".
 *  2. Menu Extensions > Apps Script, hapus isi Code.gs, tempel seluruh berkas ini.
 *  3. Simpan, lalu Deploy > New deployment > type: Web app.
 *       Execute as        : Me
 *       Who has access    : Anyone
 *  4. Salin URL ".../exec", tempel di menu Pengaturan pada peta.
 *
 * Setiap penambahan kolom baru cukup ditambahkan pada HEADERS di bawah.
 */

var SHEET_KEJADIAN = 'Kejadian';
var SHEET_LOG = 'Log';

var HEADERS = [
  'kode', 'uid', 'kawasan', 'jenis', 'jenis_lain', 'kelas_bahaya',
  'tahun', 'bulan', 'musim',
  'tanggal_mulai', 'tanggal_selesai', 'lama_jam', 'keparahan',
  'lokasi', 'aset_terdampak', 'dampak',
  'kedalaman_cm', 'tinggi_gelombang_m', 'panjang_terdampak_m', 'luas_terdampak_m2',
  'kerugian_rp', 'biaya_penanganan_rp', 'penanganan',
  'sumber', 'sumber_detail', 'pencatat', 'catatan',
  'tipe_geometri', 'lat', 'lon', 'geometry_geojson',
  'dibuat', 'diperbarui', 'dihapus'
];

var KODE_KAWASAN = { nusa_dua: 'ND', mandalika: 'MDL', golo_mori: 'GM' };


/* ------------------------------------------------------------------ utils */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_KEJADIAN);
  if (!sh) {
    sh = ss.insertSheet(SHEET_KEJADIAN);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0];
  // tambah kolom yang belum ada tanpa mengubah urutan kolom lama
  for (var i = 0; i < HEADERS.length; i++) {
    if (head.indexOf(HEADERS[i]) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(HEADERS[i]);
      head.push(HEADERS[i]);
    }
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn())
    .setFontWeight('bold')
    .setBackground('#0f2a44')
    .setFontColor('#ffffff');
  return sh;
}

function headerMap_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < head.length; i++) map[String(head[i])] = i;
  return map;
}

function output_(e, obj) {
  var cb = e && e.parameter ? e.parameter.callback : null;
  var json = JSON.stringify(obj);
  if (cb) {
    return ContentService
      .createTextOutput(cb + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function rowToObj_(row, map) {
  var o = {};
  for (var key in map) o[key] = row[map[key]];
  // tanggal dari Sheets bisa berupa Date, normalkan ke string
  ['tanggal_mulai', 'tanggal_selesai', 'dibuat', 'diperbarui'].forEach(function (k) {
    if (o[k] instanceof Date) {
      o[k] = (k === 'dibuat' || k === 'diperbarui')
        ? o[k].toISOString()
        : Utilities.formatDate(o[k], Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else if (o[k]) {
      o[k] = String(o[k]);
    }
  });
  return o;
}

function nextKode_(sh, map, kawasan) {
  var prefix = KODE_KAWASAN[kawasan] || 'KJD';
  var last = sh.getLastRow();
  var max = 0;
  if (last > 1) {
    var kodes = sh.getRange(2, map.kode + 1, last - 1, 1).getValues();
    for (var i = 0; i < kodes.length; i++) {
      var m = String(kodes[i][0] || '').match(/^([A-Z]+)-(\d+)$/);
      if (m && m[1] === prefix) max = Math.max(max, parseInt(m[2], 10));
    }
  }
  var n = max + 1;
  return prefix + '-' + (n < 100 ? ('00' + n).slice(-3) : String(n));
}

function findRowByUid_(sh, map, uid) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var uids = sh.getRange(2, map.uid + 1, last - 1, 1).getValues();
  for (var i = 0; i < uids.length; i++) {
    if (String(uids[i][0]) === String(uid)) return i + 2;
  }
  return 0;
}

function log_(aksi, uid, pencatat) {
  try {
    var ss = ss_();
    var sh = ss.getSheetByName(SHEET_LOG);
    if (!sh) {
      sh = ss.insertSheet(SHEET_LOG);
      sh.getRange(1, 1, 1, 4).setValues([['waktu', 'aksi', 'uid', 'pencatat']]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), aksi, uid || '', pencatat || '']);
  } catch (err) { /* log tidak boleh menggagalkan penyimpanan */ }
}

/* ------------------------------------------------------------------ doGet */

function doGet(e) {
  e = e || { parameter: {} };
  var action = e.parameter.action || 'list';
  try {
    if (action === 'ping') {
      return output_(e, { ok: true, pesan: 'tersambung', spreadsheet: ss_().getName() });
    }
    if (action === 'list') {
      var sh = sheet_();
      var map = headerMap_(sh);
      var last = sh.getLastRow();
      var data = [];
      if (last > 1) {
        var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
        var filter = e.parameter.kawasan || '';
        for (var i = 0; i < rows.length; i++) {
          var o = rowToObj_(rows[i], map);
          if (!o.uid) continue;
          if (String(o.dihapus) === 'true' || o.dihapus === true) continue;
          if (filter && String(o.kawasan) !== filter) continue;
          data.push(o);
        }
      }
      return output_(e, { ok: true, data: data, jumlah: data.length });
    }
    return output_(e, { ok: false, pesan: 'aksi tidak dikenal: ' + action });
  } catch (err) {
    return output_(e, { ok: false, pesan: String(err) });
  }
}

/* ----------------------------------------------------------------- doPost */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return output_(e, { ok: false, pesan: 'server sibuk, coba lagi' });
  }
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    var action = body.action || (e && e.parameter ? e.parameter.action : '') || 'simpan';

    if (action === 'simpan') return output_(e, simpan_(body.data || body.rekaman || {}));
    if (action === 'simpan_banyak') {
      var hasil = [];
      var daftar = body.data || [];
      for (var i = 0; i < daftar.length; i++) hasil.push(simpan_(daftar[i]));
      return output_(e, { ok: true, hasil: hasil });
    }
    if (action === 'hapus') return output_(e, hapus_(body.uid, body.pencatat));
    return output_(e, { ok: false, pesan: 'aksi tidak dikenal: ' + action });
  } catch (err) {
    return output_(e, { ok: false, pesan: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function simpan_(rek) {
  if (!rek || !rek.uid) return { ok: false, pesan: 'uid kosong' };
  var sh = sheet_();
  var map = headerMap_(sh);
  var now = new Date().toISOString();
  var baris = findRowByUid_(sh, map, rek.uid);

  if (!rek.kode) {
    rek.kode = baris
      ? sh.getRange(baris, map.kode + 1).getValue()
      : nextKode_(sh, map, rek.kawasan);
  }
  rek.diperbarui = now;
  if (!baris) rek.dibuat = rek.dibuat || now;

  var adalahBaru = !baris;
  var ncol = sh.getLastColumn();
  var nilai = new Array(ncol).fill('');
  if (baris) nilai = sh.getRange(baris, 1, 1, ncol).getValues()[0];

  for (var key in map) {
    if (rek.hasOwnProperty(key)) {
      var v = rek[key];
      if (Array.isArray(v)) v = v.join('; ');
      if (v === null || v === undefined) v = '';
      nilai[map[key]] = v;
    }
  }
  nilai[map.dihapus] = '';

  if (baris) {
    sh.getRange(baris, 1, 1, ncol).setValues([nilai]);
  } else {
    sh.appendRow(nilai);
    baris = sh.getLastRow();
  }
  log_(adalahBaru ? 'tambah' : 'ubah', rek.uid, rek.pencatat);
  return { ok: true, uid: rek.uid, kode: rek.kode, diperbarui: now };
}

function hapus_(uid, pencatat) {
  if (!uid) return { ok: false, pesan: 'uid kosong' };
  var sh = sheet_();
  var map = headerMap_(sh);
  var baris = findRowByUid_(sh, map, uid);
  if (!baris) return { ok: false, pesan: 'data tidak ditemukan' };
  // baris tidak dibuang, hanya ditandai, supaya riwayat lapangan tetap utuh
  sh.getRange(baris, map.dihapus + 1).setValue('true');
  sh.getRange(baris, map.diperbarui + 1).setValue(new Date().toISOString());
  sh.getRange(baris, 1, 1, sh.getLastColumn()).setFontColor('#9aa4b2').setFontLine('line-through');
  log_('hapus', uid, pencatat);
  return { ok: true, uid: uid };
}
