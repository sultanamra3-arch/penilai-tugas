'use strict';

/* ---------- penyimpanan di HP ---------- */
const simpan = {
  ambil(k, bawaan) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? bawaan; } catch { return bawaan; }
  },
  taruh(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch { toast('Gagal menyimpan: memori aplikasi penuh. Unduh Excel lalu hapus nilai lama.'); return false; }
  },
};

let daftarTugas = simpan.ambil('pt_tugas', []);
let daftarNilai = simpan.ambil('pt_nilai', []);
let setelan = Object.assign({ apiKey: '', model: 'gemini-2.5-flash' }, simpan.ambil('pt_setelan', {}));

const MODEL_BAWAAN = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...anak) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const a of anak.flat()) if (a != null) e.append(a instanceof Node ? a : String(a));
  return e;
};
const idBaru = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtTgl = (t) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3500);
}
function pesan(wadah, teks, jenis) {
  wadah.replaceChildren(teks ? el('div', { class: 'pesan ' + (jenis || '') }, teks) : '');
}
function memuat(wadah, teks) {
  wadah.replaceChildren(el('div', { class: 'memuat' }, el('div', { class: 'putar' }), teks));
}

/* ---------- tab ---------- */
let tabAktif = 'nilai';
function bukaTab(nama) {
  tabAktif = nama;
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== 'v-' + nama;
  for (const b of document.querySelectorAll('nav button')) {
    if (b.dataset.tab === nama) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (nama === 'nilai') renderNilai();
  if (nama === 'tugas') renderTugas();
  if (nama === 'rekap') renderRekap();
  if (nama === 'setelan') renderSetelan();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => bukaTab(b.dataset.tab)));
document.querySelectorAll('[data-buka]').forEach((b) => b.addEventListener('click', () => bukaTab(b.dataset.buka)));
// Tombol kembali Android: ke tab Nilai dulu sebelum keluar.
window.kembali = () => { if (tabAktif !== 'nilai') { bukaTab('nilai'); return true; } return false; };

/* ---------- foto ---------- */
async function kecilkanFoto(file, sisiMaks = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, gagal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => gagal(new Error('Foto tidak bisa dibuka'));
      i.src = url;
    });
    const skala = Math.min(1, sisiMaks / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * skala);
    c.height = Math.round(img.naturalHeight * skala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { dataUrl, base64: dataUrl.split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- Gemini ---------- */
async function gemini(teks, fotoList = []) {
  if (!setelan.apiKey) throw new Error('API key Gemini belum diisi. Buka tab Setelan.');
  const parts = [{ text: teks }];
  for (const f of fotoList) parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });

  let r;
  try {
    r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(setelan.model) + ':generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': setelan.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      },
    );
  } catch {
    throw new Error('Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(pesanGalat(r.status, j));

  const kandidat = j.candidates?.[0];
  const hasil = (kandidat?.content?.parts || []).map((p) => p.text || '').join('');
  if (!hasil) {
    const alasan = j.promptFeedback?.blockReason || kandidat?.finishReason || 'tidak diketahui';
    throw new Error('Gemini tidak memberi jawaban (' + alasan + '). Coba foto ulang dengan lebih jelas.');
  }
  return bacaJSON(hasil);
}

function pesanGalat(status, j) {
  const asli = j?.error?.message || '';
  if (status === 400 && /api key/i.test(asli)) return 'API key tidak valid. Periksa lagi di tab Setelan.';
  if (status === 403) return 'API key ditolak. Pastikan key dari aistudio.google.com dan masih aktif.';
  if (status === 404) return 'Model "' + setelan.model + '" tidak ditemukan. Pilih model lain di tab Setelan.';
  if (status === 429) return 'Batas pemakaian gratis Gemini sedang penuh. Tunggu sekitar 1 menit lalu coba lagi.';
  if (status >= 500) return 'Server Gemini sedang sibuk. Coba lagi sebentar lagi.';
  return 'Gemini menolak permintaan (' + status + '): ' + asli;
}

function bacaJSON(s) {
  try { return JSON.parse(s); } catch { /* lanjut */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* lanjut */ } }
  throw new Error('Jawaban Gemini tidak terbaca. Coba lagi.');
}

/* ---------- prompt penilaian ---------- */
function promptPenilaian(tugas, namaDiisi) {
  return `Kamu adalah guru yang teliti dan adil. Foto terlampir adalah lembar jawaban seorang siswa (bisa lebih dari satu halaman, urut).

TUGAS: ${tugas.judul}${tugas.mapel ? ' (' + tugas.mapel + ')' : ''}

KUNCI JAWABAN DAN CARA MENILAI (dari guru):
"""
${tugas.kunci}
"""

ATURAN MENILAI:
- Soal tanpa keterangan jenis adalah pilihan ganda. Benar jika pilihan siswa sama dengan kunci. Jika siswa memilih lebih dari satu atau coretannya tidak jelas, skor 0 dan beri catatan.
- (isian): terima jawaban yang maknanya sama, sinonim, atau salah ejaan kecil.
- (esai): beri skor sebagian sesuai rubrik atau poin kunci yang ditulis guru.
- (pendapat): tidak ada jawaban benar atau salah. Nilai dari kejelasan pendapat, kekuatan alasan, dan kaitannya dengan pertanyaan. Pendapat yang berbeda dari guru tetap boleh mendapat skor penuh jika alasannya baik.
- Bobot: pakai poin yang ditulis guru. Jika tidak ditulis: pilihan ganda dan isian 1 poin, esai dan pendapat 5 poin.
- Nilai SEMUA soal yang ada di kunci, termasuk yang tidak dijawab siswa (skor 0, jawaban "(kosong)").
- Jika tulisan tidak terbaca, tulis "(tidak terbaca)", beri skor 0, dan jelaskan di catatan.
- Jangan mengarang jawaban siswa. Tulis persis yang terbaca.
${namaDiisi ? '' : '- Baca juga nama dan kelas siswa dari lembar jawaban jika ada.\n'}
Balas HANYA dengan JSON dengan bentuk ini:
{
  "nama": "nama siswa yang terbaca atau kosong",
  "kelas": "kelas yang terbaca atau kosong",
  "soal": [
    {"no": "1", "jenis": "pg|isian|esai|pendapat", "jawaban_siswa": "...", "skor": 1, "skor_maks": 1, "catatan": "alasan singkat, terutama jika salah atau sebagian"}
  ],
  "komentar": "1-2 kalimat umpan balik untuk siswa dalam Bahasa Indonesia yang ramah"
}`;
}

function rapikanHasil(h) {
  const soal = (Array.isArray(h.soal) ? h.soal : []).map((s, i) => {
    const maks = Math.max(0, Number(s.skor_maks) || 0);
    const skor = Math.min(maks, Math.max(0, Number(s.skor) || 0));
    return {
      no: String(s.no ?? i + 1),
      jenis: String(s.jenis || 'pg').toLowerCase(),
      jawaban: String(s.jawaban_siswa ?? ''),
      skor, maks,
      catatan: String(s.catatan || ''),
    };
  });
  return { nama: String(h.nama || '').trim(), kelas: String(h.kelas || '').trim(), soal, komentar: String(h.komentar || '') };
}

function hitung(soal) {
  const skor = soal.reduce((a, s) => a + s.skor, 0);
  const maks = soal.reduce((a, s) => a + s.maks, 0);
  return { skor, maks, nilai: maks ? Math.round((skor / maks) * 100) : 0 };
}

/* ======================================================
   TAB NILAI
   ====================================================== */
let fotoSiswa = []; // {dataUrl, base64}
let hasilSekarang = null;
let sedangMenilai = false;

function renderNilai() {
  $('#perlu-setelan').hidden = !!setelan.apiKey;
  const sel = $('#n-tugas');
  const dipilih = sel.value || simpan.ambil('pt_tugas_terakhir', '');
  sel.replaceChildren();
  if (!daftarTugas.length) {
    sel.append(el('option', { value: '' }, 'Belum ada tugas, buat di tab Tugas'));
  } else {
    for (const t of daftarTugas) sel.append(el('option', { value: t.id }, t.judul + (t.kelas ? ' · ' + t.kelas : '')));
    if (daftarTugas.some((t) => t.id === dipilih)) sel.value = dipilih;
  }
  renderFoto();
}

function renderFoto() {
  const w = $('#n-foto-wrap');
  if (!fotoSiswa.length) {
    w.replaceChildren(el('div', { class: 'kosong' },
      el('div', {}, 'Foto lembar jawaban siswa. Satu siswa boleh beberapa halaman.'),
      el('button', { class: 'garis', onclick: () => $('#n-file').click() }, 'Ambil / pilih foto')));
  } else {
    w.replaceChildren(
      el('div', { class: 'foto-grid' },
        fotoSiswa.map((f, i) => el('div', { class: 'foto' },
          el('img', { src: f.dataUrl, alt: 'Halaman ' + (i + 1) }),
          el('button', { 'aria-label': 'Hapus halaman ' + (i + 1), onclick: () => { fotoSiswa.splice(i, 1); renderFoto(); } }, '×')))),
      el('button', { class: 'garis', onclick: () => $('#n-file').click() }, '+ Tambah halaman'));
  }
  $('#n-nilai').disabled = sedangMenilai || !fotoSiswa.length || !daftarTugas.length;
}

$('#n-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    try { fotoSiswa.push(await kecilkanFoto(f)); } catch (err) { toast(err.message); }
  }
  renderFoto();
});
$('#n-tugas').addEventListener('change', (e) => {
  simpan.taruh('pt_tugas_terakhir', e.target.value);
  const t = daftarTugas.find((x) => x.id === e.target.value);
  if (t && t.kelas && !t.kelas.includes(',')) $('#n-kelas').value = t.kelas;
});

$('#n-nilai').addEventListener('click', async () => {
  const tugas = daftarTugas.find((t) => t.id === $('#n-tugas').value);
  if (!tugas) return toast('Pilih tugas dulu');
  sedangMenilai = true;
  renderFoto();
  $('#n-hasil').hidden = true;
  memuat($('#n-status'), 'Gemini sedang membaca dan menilai... (10–40 detik)');
  try {
    const namaDiisi = $('#n-nama').value.trim();
    const h = rapikanHasil(await gemini(promptPenilaian(tugas, namaDiisi), fotoSiswa));
    if (!h.soal.length) throw new Error('Tidak ada soal yang terbaca. Pastikan foto jelas dan kunci jawaban sudah benar.');
    hasilSekarang = {
      id: idBaru(), tugasId: tugas.id,
      nama: namaDiisi || h.nama || '',
      kelas: $('#n-kelas').value.trim() || h.kelas || '',
      soal: h.soal, komentar: h.komentar,
    };
    pesan($('#n-status'), '');
    renderHasil();
  } catch (err) {
    pesan($('#n-status'), err.message, 'err');
  } finally {
    sedangMenilai = false;
    renderFoto();
  }
});

function renderHasil() {
  const h = hasilSekarang;
  const box = $('#n-hasil');
  const total = el('div', { class: 'lingkar' });
  const ket = el('div', { class: 'kecil' });
  const segarkan = () => {
    const t = hitung(h.soal);
    total.textContent = t.nilai;
    ket.textContent = `Skor ${fmtAngka(t.skor)} dari ${fmtAngka(t.maks)} poin`;
  };

  const inNama = el('input', { id: 'h-nama', value: h.nama, placeholder: 'Nama siswa', oninput: (e) => { h.nama = e.target.value; } });
  const inKelas = el('input', { id: 'h-kelas', value: h.kelas, placeholder: 'Kelas', oninput: (e) => { h.kelas = e.target.value; } });

  const rows = h.soal.map((s, i) => {
    const status = s.maks && s.skor >= s.maks ? 'benar' : s.skor > 0 ? 'sebagian' : 'salah';
    const chip = el('span', { class: 'chip st-' + status }, s.jenis);
    const inp = el('input', {
      id: 'h-skor-' + i, type: 'number', inputmode: 'decimal', min: 0, max: s.maks, step: 'any', value: s.skor,
      'aria-label': 'Skor soal ' + s.no,
      oninput: (e) => {
        let v = Number(e.target.value);
        if (!isFinite(v)) v = 0;
        s.skor = Math.min(s.maks, Math.max(0, v));
        const st = s.maks && s.skor >= s.maks ? 'benar' : s.skor > 0 ? 'sebagian' : 'salah';
        chip.className = 'chip st-' + st;
        segarkan();
      },
    });
    return el('div', { class: 'soal' },
      el('div', { class: 'no' }, s.no),
      el('div', { class: 'isi' },
        el('div', {}, chip, s.jawaban || '(kosong)'),
        s.catatan ? el('div', { class: 'kecil' }, s.catatan) : null),
      el('div', { class: 'skor' }, inp, el('span', { class: 'kecil' }, '/' + fmtAngka(s.maks))));
  });

  const inKomentar = el('textarea', { id: 'h-komentar', style: 'min-height:70px;font-family:inherit;background-image:none', oninput: (e) => { h.komentar = e.target.value; } });
  inKomentar.value = h.komentar;

  box.replaceChildren(
    el('div', { class: 'nilai-besar' }, total, el('div', {}, el('h2', {}, 'Hasil penilaian'), ket,
      el('div', { class: 'kecil' }, 'Periksa lalu ubah skor jika perlu.'))),
    el('div', { class: 'baris' }, el('label', {}, 'Nama', inNama), el('label', {}, 'Kelas', inKelas)),
    el('div', {}, rows),
    el('label', {}, 'Komentar untuk siswa', inKomentar),
    el('div', { class: 'baris' },
      el('button', { class: 'garis', onclick: () => { hasilSekarang = null; box.hidden = true; } }, 'Buang'),
      el('button', { class: 'utama', onclick: simpanHasil }, 'Simpan nilai')),
  );
  segarkan();
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fmtAngka(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','); }

function simpanHasil() {
  const h = hasilSekarang;
  if (!h) return;
  if (!h.nama.trim()) { toast('Isi nama siswa dulu'); $('#h-nama').focus(); return; }
  const t = hitung(h.soal);
  const rec = { ...h, nama: h.nama.trim(), kelas: h.kelas.trim(), skor: t.skor, maks: t.maks, nilai: t.nilai, waktu: Date.now() };
  daftarNilai.unshift(rec);
  if (!simpan.taruh('pt_nilai', daftarNilai)) { daftarNilai.shift(); return; }
  toast(`Tersimpan: ${rec.nama} mendapat ${rec.nilai}`);
  // Siap untuk siswa berikutnya.
  hasilSekarang = null;
  fotoSiswa = [];
  $('#n-nama').value = '';
  $('#n-hasil').hidden = true;
  pesan($('#n-status'), `Nilai ${rec.nama} tersimpan (${rec.nilai}). Silakan foto siswa berikutnya.`, 'ok');
  renderFoto();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ======================================================
   TAB TUGAS
   ====================================================== */
let tugasDiedit = null;

const CONTOH_KUNCI = `1. B
2. D
3. A
4. C
5. (isian) fotosintesis
6. (isian) klorofil
7. (esai, 10 poin) Jelaskan proses fotosintesis. Skor penuh jika menyebut: cahaya matahari, air, karbon dioksida, menghasilkan glukosa dan oksigen. Kurangi 2 poin untuk tiap unsur yang tidak disebut.
8. (pendapat, 10 poin) Setujukah kamu jika hutan di dekat sekolah ditebang untuk lahan parkir? Nilai dari kejelasan sikap dan minimal 2 alasan yang masuk akal.`;

function renderTugas() {
  const d = $('#t-daftar');
  if (!daftarTugas.length) {
    d.replaceChildren(el('div', { class: 'kosong' }, 'Belum ada tugas. Isi form di atas, atau ketuk "Isi contoh" untuk melihat formatnya.'));
    return;
  }
  d.replaceChildren(...daftarTugas.map((t) => {
    const jml = daftarNilai.filter((n) => n.tugasId === t.id).length;
    const hapus = el('button', { class: 'teks' }, 'Hapus');
    hapus.addEventListener('click', () => {
      if (hapus.dataset.yakin) {
        daftarTugas = daftarTugas.filter((x) => x.id !== t.id);
        simpan.taruh('pt_tugas', daftarTugas);
        renderTugas();
        toast('Tugas dihapus. Nilai yang sudah ada tetap tersimpan.');
      } else {
        hapus.dataset.yakin = '1';
        hapus.textContent = 'Yakin hapus?';
        setTimeout(() => { delete hapus.dataset.yakin; hapus.textContent = 'Hapus'; }, 3000);
      }
    });
    return el('div', { class: 'item' },
      el('div', { class: 'tengah' },
        el('div', { class: 'judul' }, t.judul),
        el('div', { class: 'kecil' }, [t.mapel, t.kelas, jml + ' siswa dinilai'].filter(Boolean).join(' · '))),
      el('button', { class: 'teks', onclick: () => editTugas(t) }, 'Ubah'),
      hapus);
  }));
}

function editTugas(t) {
  tugasDiedit = t ? t.id : null;
  $('#t-judul').value = t ? t.judul : '';
  $('#t-mapel').value = t ? t.mapel : '';
  $('#t-kelas').value = t ? t.kelas : '';
  $('#t-kunci').value = t ? t.kunci : '';
  $('#t-judul-form').textContent = t ? 'Ubah tugas' : 'Tugas baru';
  $('#t-batal').hidden = !t;
  pesan($('#t-status'), '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#t-batal').addEventListener('click', () => editTugas(null));
$('#t-contoh').addEventListener('click', () => {
  if (!$('#t-judul').value) $('#t-judul').value = 'Ulangan Harian Fotosintesis';
  if (!$('#t-mapel').value) $('#t-mapel').value = 'IPA';
  $('#t-kunci').value = CONTOH_KUNCI;
});
$('#t-simpan').addEventListener('click', () => {
  const data = {
    judul: $('#t-judul').value.trim(),
    mapel: $('#t-mapel').value.trim(),
    kelas: $('#t-kelas').value.trim(),
    kunci: $('#t-kunci').value.trim(),
  };
  if (!data.judul) return pesan($('#t-status'), 'Isi nama tugas dulu.', 'err');
  if (!data.kunci) return pesan($('#t-status'), 'Isi kunci jawaban dulu.', 'err');
  if (tugasDiedit) {
    daftarTugas = daftarTugas.map((t) => (t.id === tugasDiedit ? { ...t, ...data } : t));
  } else {
    const baru = { id: idBaru(), dibuat: Date.now(), ...data };
    daftarTugas.unshift(baru);
    simpan.taruh('pt_tugas_terakhir', baru.id);
  }
  simpan.taruh('pt_tugas', daftarTugas);
  toast(tugasDiedit ? 'Tugas diperbarui' : 'Tugas tersimpan. Sekarang bisa mulai menilai.');
  editTugas(null);
  renderTugas();
});

$('#t-foto-kunci').addEventListener('click', () => $('#t-file').click());
$('#t-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const st = $('#t-status');
  memuat(st, 'Membaca kunci jawaban dari foto...');
  try {
    const foto = [];
    for (const f of files) foto.push(await kecilkanFoto(f));
    const h = await gemini(`Foto terlampir adalah lembar soal dan/atau kunci jawaban milik guru. Tuliskan ulang kunci jawabannya, satu soal per baris, dengan format:
- Pilihan ganda: "1. B"
- Isian singkat: "5. (isian) jawaban"
- Esai: "7. (esai, N poin) ringkasan pertanyaan. Poin kunci jawaban: ..."
- Pendapat: "8. (pendapat, N poin) ringkasan pertanyaan. Nilai dari alasan."
Jika poin tidak tertulis, jangan tulis poin. Balas HANYA JSON: {"judul": "judul tugas jika ada", "mapel": "mapel jika ada", "kunci": "teks kunci, baris dipisah \\n"}`, foto);
    if (!h.kunci) throw new Error('Kunci jawaban tidak ditemukan di foto.');
    $('#t-kunci').value = String(h.kunci).trim();
    if (!$('#t-judul').value && h.judul) $('#t-judul').value = h.judul;
    if (!$('#t-mapel').value && h.mapel) $('#t-mapel').value = h.mapel;
    pesan(st, 'Kunci terbaca. Periksa dan perbaiki bila perlu, lalu simpan.', 'ok');
  } catch (err) {
    pesan(st, err.message, 'err');
  }
});

/* ======================================================
   TAB REKAP
   ====================================================== */
function nilaiTersaring() {
  const k = $('#r-kelas').value, t = $('#r-tugas').value;
  return daftarNilai.filter((n) => (!k || n.kelas === k) && (!t || n.tugasId === t));
}
const namaTugas = (id) => daftarTugas.find((t) => t.id === id)?.judul || '(tugas dihapus)';
const mapelTugas = (id) => daftarTugas.find((t) => t.id === id)?.mapel || '';

function isiPilihan(sel, opsi, labelSemua) {
  const lama = sel.value;
  sel.replaceChildren(el('option', { value: '' }, labelSemua), ...opsi.map(([v, l]) => el('option', { value: v }, l)));
  if (opsi.some(([v]) => v === lama)) sel.value = lama;
}

function renderRekap() {
  const kelas = [...new Set(daftarNilai.map((n) => n.kelas).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  isiPilihan($('#r-kelas'), kelas.map((k) => [k, k]), 'Semua kelas');
  const idTugas = [...new Set(daftarNilai.map((n) => n.tugasId))];
  isiPilihan($('#r-tugas'), idTugas.map((id) => [id, namaTugas(id)]), 'Semua tugas');

  const data = nilaiTersaring().slice().sort((a, b) => a.kelas.localeCompare(b.kelas, 'id') || a.nama.localeCompare(b.nama, 'id'));
  const rata = data.length ? data.reduce((a, n) => a + n.nilai, 0) / data.length : 0;
  $('#r-ringkas').replaceChildren(
    el('div', {}, el('b', {}, data.length), el('span', {}, 'siswa')),
    el('div', {}, el('b', {}, data.length ? fmtAngka(Math.round(rata * 10) / 10) : '–'), el('span', {}, 'rata-rata')),
    el('div', {}, el('b', {}, data.length ? Math.max(...data.map((n) => n.nilai)) : '–'), el('span', {}, 'tertinggi')));

  const tabel = $('#r-tabel');
  if (!data.length) {
    tabel.replaceChildren(el('tr', {}, el('td', { class: 'kecil' }, 'Belum ada nilai. Nilai tersimpan dari tab Nilai akan muncul di sini.')));
    $('#r-excel').disabled = true;
    return;
  }
  $('#r-excel').disabled = false;
  tabel.replaceChildren(
    el('thead', {}, el('tr', {}, el('th', {}, 'Nama'), el('th', {}, 'Kelas'), el('th', { class: 'angka' }, 'Nilai'), el('th', {}, 'Tugas'), el('th', {}, ''))),
    el('tbody', {}, data.map((n) => {
      const hapus = el('button', { class: 'teks' }, 'Hapus');
      hapus.addEventListener('click', () => {
        if (hapus.dataset.yakin) {
          daftarNilai = daftarNilai.filter((x) => x.id !== n.id);
          simpan.taruh('pt_nilai', daftarNilai);
          renderRekap();
        } else {
          hapus.dataset.yakin = '1';
          hapus.textContent = 'Yakin?';
          setTimeout(() => { delete hapus.dataset.yakin; hapus.textContent = 'Hapus'; }, 3000);
        }
      });
      return el('tr', {},
        el('td', {}, n.nama), el('td', {}, n.kelas || '–'),
        el('td', { class: 'angka' }, el('b', {}, n.nilai)), el('td', {}, namaTugas(n.tugasId)), el('td', {}, hapus));
    })));
}
$('#r-kelas').addEventListener('change', renderRekap);
$('#r-tugas').addEventListener('change', renderRekap);

$('#r-excel').addEventListener('click', () => {
  const data = nilaiTersaring().slice().sort((a, b) => a.kelas.localeCompare(b.kelas, 'id') || a.nama.localeCompare(b.nama, 'id'));
  if (!data.length) return;
  if (typeof XLSX === 'undefined') return toast('Modul Excel gagal dimuat');

  const rekap = data.map((n, i) => ({
    No: i + 1, Nama: n.nama, Kelas: n.kelas, Tugas: namaTugas(n.tugasId), Mapel: mapelTugas(n.tugasId),
    Skor: n.skor, 'Skor Maks': n.maks, Nilai: n.nilai, Tanggal: fmtTgl(n.waktu), Komentar: n.komentar,
  }));
  const rincian = data.flatMap((n) => n.soal.map((s) => ({
    Nama: n.nama, Kelas: n.kelas, Tugas: namaTugas(n.tugasId), 'No Soal': s.no, Jenis: s.jenis,
    'Jawaban Siswa': s.jawaban, Skor: s.skor, 'Skor Maks': s.maks, Catatan: s.catatan,
  })));
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(rekap);
  ws1['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 8 }, { wch: 28 }, { wch: 12 }, { wch: 6 }, { wch: 9 }, { wch: 6 }, { wch: 13 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Rekap');
  const ws2 = XLSX.utils.json_to_sheet(rincian);
  ws2['!cols'] = [{ wch: 26 }, { wch: 8 }, { wch: 28 }, { wch: 7 }, { wch: 9 }, { wch: 40 }, { wch: 6 }, { wch: 9 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Rincian per soal');

  const k = $('#r-kelas').value, t = $('#r-tugas').value;
  const bagian = ['Nilai', t ? namaTugas(t) : '', k, new Date().toISOString().slice(0, 10)].filter(Boolean);
  const nama = bagian.join(' ').replace(/[\\/:*?"<>|]+/g, '-') + '.xlsx';
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (window.AndroidApp?.saveFile) {
    const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const r = window.AndroidApp.saveFile(nama, b64, mime);
    toast(r.startsWith('ERROR') ? 'Gagal menyimpan Excel: ' + r.slice(7) : r);
  } else {
    XLSX.writeFile(wb, nama); // saat dibuka di browser biasa
  }
});

/* ======================================================
   TAB SETELAN
   ====================================================== */
function isiModel(daftar) {
  const sel = $('#s-model');
  const semua = [...new Set([setelan.model, ...daftar])].filter(Boolean);
  sel.replaceChildren(...semua.map((m) => el('option', { value: m }, m)));
  sel.value = setelan.model;
}

function renderSetelan() {
  $('#s-key').value = setelan.apiKey;
  isiModel(simpan.ambil('pt_model_list', MODEL_BAWAAN));
  $('#s-info').textContent = `${daftarTugas.length} tugas dan ${daftarNilai.length} nilai tersimpan di HP ini.`;
}

$('#s-tampil').addEventListener('click', (e) => {
  const i = $('#s-key');
  i.type = i.type === 'password' ? 'text' : 'password';
  e.target.textContent = i.type === 'password' ? 'Tampilkan key' : 'Sembunyikan key';
});
$('#s-model').addEventListener('change', (e) => {
  setelan.model = e.target.value;
  simpan.taruh('pt_setelan', setelan);
});

$('#s-cek').addEventListener('click', async () => {
  const key = $('#s-key').value.trim();
  const st = $('#s-status');
  if (!key) return pesan(st, 'Tempel API key dulu.', 'err');
  setelan.apiKey = key;
  setelan.model = $('#s-model').value || setelan.model;
  simpan.taruh('pt_setelan', setelan);
  memuat(st, 'Mengecek API key...');
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(pesanGalat(r.status, j));
    const model = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/(tts|image|embed|live|audio)/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''));
    if (model.length) {
      simpan.taruh('pt_model_list', model);
      if (!model.includes(setelan.model)) {
        setelan.model = model.find((m) => /flash/.test(m) && !/lite/.test(m)) || model[0];
        simpan.taruh('pt_setelan', setelan);
      }
      isiModel(model);
    }
    pesan(st, 'API key aktif. Model dipakai: ' + setelan.model + '. Sekarang buat tugas di tab Tugas.', 'ok');
  } catch (err) {
    pesan(st, err.message === 'Failed to fetch' ? 'Tidak ada koneksi internet.' : err.message, 'err');
  }
});

/* ---------- mulai ---------- */
bukaTab(setelan.apiKey ? (daftarTugas.length ? 'nilai' : 'tugas') : 'setelan');
