/* ------------------------------------------------------------------
   Konfigurasi situs. Ubah berkas ini setelah Apps Script di-deploy,
   supaya semua pengguna langsung tersambung tanpa mengisi manual.
   ------------------------------------------------------------------ */
window.KONFIG = {
  // URL Web App Apps Script, berakhiran /exec. Kosongkan kalau mau
  // diisi masing-masing pengguna lewat menu Pengaturan.
  URL_APPS_SCRIPT: "https://script.google.com/macros/s/AKfycbzaB0FGz--Dd_tUUPp0gZltQFvrHwdI2eartImo9IRWnH2FDl75cuowkbQaCsrK6OcvXw/exec",

  // Nama yang otomatis mengisi kolom "Pencatat" pada formulir.
  PENCATAT_BAWAAN: "",

  // Muat data dari spreadsheet setiap kali kawasan dibuka.
  MUAT_OTOMATIS: true
};
