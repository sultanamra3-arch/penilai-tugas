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
let daftarKelas = simpan.ambil('pt_kelas', []); // [{id, nama, siswa:[{id, no, nama}]}]
let setelan = Object.assign({ apiKey: '', model: 'gemini-2.5-flash', sekolah: '', guru: '' }, simpan.ambil('pt_setelan', {}));

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
const fmtTgl = (t) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtAngka(n) { n = Number(n) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','); }
const urutNama = (a, b) => String(a).localeCompare(String(b), 'id');

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
function tombolYakin(label, aksi) {
  const b = el('button', { class: 'teks' }, label);
  b.addEventListener('click', () => {
    if (b.dataset.yakin) { aksi(); return; }
    b.dataset.yakin = '1'; b.textContent = 'Yakin?';
    setTimeout(() => { delete b.dataset.yakin; b.textContent = label; }, 3000);
  });
  return b;
}

/* ---------- tab ---------- */
let tabAktif = 'nilai';
function bukaTab(nama) {
  tabAktif = nama;
  $('#sub').textContent = ({ nilai: 'Foto lembar jawaban, nilai keluar otomatis', tugas: 'Kunci jawaban dan cara menilai', kelas: 'Daftar siswa per kelas',
    rekap: 'Nilai per kelas dan tugas, edit, dan cetak', setelan: 'API key Gemini dan kop hasil koreksi' })[nama] || '';
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== 'v-' + nama;
  for (const b of document.querySelectorAll('nav button')) {
    if (b.dataset.tab === nama) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (nama === 'nilai') renderNilai();
  if (nama === 'tugas') renderTugas();
  if (nama === 'kelas') renderKelas();
  if (nama === 'rekap') renderRekap();
  if (nama === 'setelan') renderSetelan();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => bukaTab(b.dataset.tab)));
document.querySelectorAll('[data-buka]').forEach((b) => b.addEventListener('click', () => bukaTab(b.dataset.buka)));
// Tombol kembali Android: tutup dialog, lalu ke tab Nilai, lalu keluar.
window.kembali = () => {
  const d = $('#edit'); if (d.open) { d.close(); return true; }
  if (tabAktif !== 'nilai') { bukaTab('nilai'); return true; }
  return false;
};

/* ---------- foto ---------- */
async function kecilkanFoto(file, sisiMaks = 1800) {
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
    const dataUrl = c.toDataURL('image/jpeg', 0.88);
    return { dataUrl, base64: dataUrl.split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- Gemini ---------- */
async function gemini(teks, fotoList = [], skema = null) {
  if (!setelan.apiKey) throw new Error('API key Gemini belum diisi. Buka tab Setelan.');
  const parts = [{ text: teks }];
  for (const f of fotoList) parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  const kirim = async (pakaiSkema) => {
    const generationConfig = { temperature: 0.1, responseMimeType: 'application/json' };
    if (pakaiSkema && skema) generationConfig.responseSchema = skema;
    let r;
    try {
      r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(setelan.model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': setelan.apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
      });
    } catch {
      throw new Error('Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.');
    }
    const j = await r.json().catch(() => ({}));
    return { r, j };
  };
  let { r, j } = await kirim(true);
  // Model lama kadang menolak skema; ulangi tanpa skema.
  if (!r.ok && r.status === 400 && skema && /schema/i.test(j?.error?.message || '')) ({ r, j } = await kirim(false));
  if (!r.ok) throw new Error(pesanGalat(r.status, j));
  const kandidat = j.candidates?.[0];
  const hasil = (kandidat?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
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
  const m = s.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* lanjut */ } }
  throw new Error('Jawaban Gemini tidak terbaca. Coba lagi.');
}

/* ---------- kunci jawaban → daftar soal ---------- */
// "1. B", "5. (isian) fotosintesis", "7. (esai, 10 poin) ...", "8. (pendapat, 10 poin) ..."
function parseKunci(teks) {
  const out = [];
  for (const baris of String(teks || '').split(/\r?\n/)) {
    const b = baris.trim();
    if (!b) continue;
    const m = b.match(/^(\d+[a-z]?)\s*[.)]\s*(.*)$/i);
    if (!m) { if (out.length) out[out.length - 1].teks += ' ' + b; continue; }
    let isi = m[2].trim(), jenis = null, poin = null;
    const t = isi.match(/^\(([^)]*)\)\s*(.*)$/);
    if (t) {
      const tag = t[1].toLowerCase(); isi = t[2].trim();
      if (/esai|uraian/.test(tag)) jenis = 'esai';
      else if (/pendapat|opini/.test(tag)) jenis = 'pendapat';
      else if (/isian|singkat/.test(tag)) jenis = 'isian';
      else if (/pg|pilihan/.test(tag)) jenis = 'pg';
      const p = tag.match(/(\d+(?:[.,]\d+)?)\s*poin/);
      if (p) poin = parseFloat(p[1].replace(',', '.'));
    }
    if (!jenis) jenis = /^[a-e](?:$|[\s.)])/i.test(isi) ? 'pg' : 'isian';
    out.push({ no: m[1], jenis, maks: poin ?? (jenis === 'esai' || jenis === 'pendapat' ? 5 : 1), teks: isi, kunciPG: jenis === 'pg' ? isi.charAt(0).toUpperCase() : '' });
  }
  return out;
}

/* ---------- penilaian 2 langkah ---------- */
// Langkah 1 (dengan foto): baca jawaban siswa apa adanya. Tidak diberi kunci supaya tidak terpengaruh.
function promptBaca(soal, bacaNama) {
  return `Kamu membantu guru membaca lembar jawaban siswa. Foto terlampir adalah lembar jawaban satu siswa (bisa beberapa halaman, urut).

Tugasmu HANYA menyalin jawaban siswa, BUKAN menilai. Daftar soal:
${soal.map((s) => `- No ${s.no}: ${s.jenis === 'pg' ? 'pilihan ganda (salin huruf yang dipilih: A, B, C, D, atau E)' : s.jenis === 'isian' ? 'isian singkat' : s.jenis === 'esai' ? 'esai/uraian (salin lengkap)' : 'pendapat (salin lengkap)'}`).join('\n')}

Aturan:
- Salin persis yang tertulis, termasuk salah ketik. Jangan memperbaiki atau menambah.
- Pilihan ganda: tulis huruf yang dilingkari/disilang. Jika ada lebih dari satu pilihan yang ditandai, tulis semuanya, mis. "A,C". Jika dicoret lalu diganti, pakai pilihan terakhir yang jelas.
- Jika soal tidak dijawab, tulis "".
- "yakin" = false bila tulisan sulit dibaca, terpotong, buram, atau kamu menebak.
${bacaNama ? '- Baca juga nama dan kelas siswa jika tertulis di lembar jawaban.' : ''}
Balas dalam JSON.`;
}
const SKEMA_BACA = {
  type: 'OBJECT',
  properties: {
    nama: { type: 'STRING' }, kelas: { type: 'STRING' },
    jawaban: { type: 'ARRAY', items: { type: 'OBJECT', properties: { no: { type: 'STRING' }, jawaban: { type: 'STRING' }, yakin: { type: 'BOOLEAN' } }, required: ['no', 'jawaban', 'yakin'] } },
  },
  required: ['jawaban'],
};

// Langkah 2 (tanpa foto): nilai jawaban non-pilihan-ganda memakai kunci, rubrik, dan contoh koreksi guru.
function promptNilai(tugas, soal, jawaban) {
  const contoh = (tugas.contohGuru || []).filter((c) => soal.some((s) => s.no === c.no)).slice(-12);
  return `Kamu guru yang teliti dan adil. Nilai jawaban siswa berikut.

TUGAS: ${tugas.judul}${tugas.mapel ? ' (' + tugas.mapel + ')' : ''}

SOAL, KUNCI, DAN SKOR MAKSIMAL:
${soal.map((s) => `- No ${s.no} [${s.jenis}, maks ${s.maks} poin]: ${s.teks || '(lihat jawaban siswa)'}`).join('\n')}

JAWABAN SISWA (hasil salinan dari foto):
${soal.map((s) => `- No ${s.no}: ${jawaban[s.no] ? JSON.stringify(jawaban[s.no]) : '(kosong)'}`).join('\n')}
${contoh.length ? `
CONTOH KOREKSI GURU SEBELUMNYA UNTUK TUGAS INI (ikuti standar guru ini):
${contoh.map((c) => `- No ${c.no}: jawaban ${JSON.stringify(c.jawaban)} → guru memberi ${c.skorGuru}/${c.maks} (penilaian awal ${c.skorAI})`).join('\n')}
` : ''}
ATURAN:
- isian: terima jawaban yang maknanya sama, sinonim, atau salah ejaan kecil. Skor penuh atau 0, kecuali kunci menyebut skor sebagian.
- esai: beri skor sebagian sesuai rubrik atau poin kunci. Sebutkan poin yang kurang di catatan.
- pendapat: tidak ada benar/salah. Nilai kejelasan sikap, kekuatan alasan, dan kaitannya dengan pertanyaan. Pendapat yang berbeda dari guru tetap boleh skor penuh bila alasannya baik.
- Jawaban kosong atau tidak terbaca: skor 0.
- Skor tidak boleh melebihi maks. Boleh pecahan 0,5.
- "ragu" = true bila jawaban ambigu atau kamu tidak yakin dengan skornya, supaya guru memeriksa.
- Catatan: 1 kalimat singkat untuk guru.
- Komentar: 1–2 kalimat umpan balik ramah untuk siswa tentang keseluruhan jawabannya.
Balas dalam JSON.`;
}
const SKEMA_NILAI = {
  type: 'OBJECT',
  properties: {
    soal: { type: 'ARRAY', items: { type: 'OBJECT', properties: { no: { type: 'STRING' }, skor: { type: 'NUMBER' }, catatan: { type: 'STRING' }, ragu: { type: 'BOOLEAN' } }, required: ['no', 'skor', 'catatan', 'ragu'] } },
    komentar: { type: 'STRING' },
  },
  required: ['soal', 'komentar'],
};

const normNo = (n) => String(n ?? '').trim().replace(/^no\.?\s*/i, '').replace(/[.)]$/, '').toLowerCase();

// Gabungkan kunci + jawaban → nilai. PG dinilai langsung dari kunci; isian/esai/pendapat oleh Gemini (tanpa foto).
async function nilaiDariJawaban(tugas, soal, jawabanMap, yakinMap) {
  const nonPG = soal.filter((s) => s.jenis !== 'pg');
  let hasilAI = { soal: [], komentar: '' };
  if (nonPG.length) {
    hasilAI = await gemini(promptNilai(tugas, nonPG, jawabanMap), [], SKEMA_NILAI);
  }
  const aiMap = {};
  for (const x of hasilAI.soal || []) aiMap[normNo(x.no)] = x;
  const hasil = soal.map((s) => {
    const jw = String(jawabanMap[s.no] ?? '').trim();
    const yakinBaca = yakinMap[s.no] !== false;
    if (s.jenis === 'pg') {
      const huruf = jw.toUpperCase().replace(/[^A-E]/g, '');
      let skor = 0, catatan = '', ragu = !yakinBaca;
      if (!jw) catatan = 'Tidak dijawab. Kunci ' + s.kunciPG + '.';
      else if (huruf.length > 1) { catatan = 'Memilih lebih dari satu (' + huruf.split('').join(', ') + '). Kunci ' + s.kunciPG + '.'; ragu = true; }
      else if (huruf === s.kunciPG) skor = s.maks;
      else catatan = 'Kunci ' + s.kunciPG + '.';
      return { no: s.no, jenis: 'pg', jawaban: jw, skor, maks: s.maks, catatan, ragu, skorAI: skor };
    }
    const a = aiMap[normNo(s.no)];
    let skor = a ? Number(a.skor) || 0 : 0;
    skor = Math.min(s.maks, Math.max(0, Math.round(skor * 2) / 2));
    return { no: s.no, jenis: s.jenis, jawaban: jw, skor, maks: s.maks, catatan: a ? String(a.catatan || '') : (jw ? 'Belum dinilai, periksa manual.' : 'Tidak dijawab.'), ragu: !yakinBaca || !a || !!a?.ragu, skorAI: skor };
  });
  let komentar = String(hasilAI.komentar || '');
  if (!komentar) {
    const pg = hasil.filter((h) => h.jenis === 'pg');
    const benar = pg.filter((h) => h.skor >= h.maks).length;
    komentar = `Benar ${benar} dari ${pg.length} soal pilihan ganda. ${benar / Math.max(1, pg.length) >= 0.8 ? 'Bagus sekali, pertahankan!' : 'Pelajari lagi soal yang salah, ya.'}`;
  }
  return { soal: hasil, komentar };
}

function hitung(soal) {
  const skor = soal.reduce((a, s) => a + (Number(s.skor) || 0), 0);
  const maks = soal.reduce((a, s) => a + (Number(s.maks) || 0), 0);
  return { skor, maks, nilai: maks ? Math.round((skor / maks) * 100) : 0 };
}

// Simpan koreksi guru sebagai contoh untuk penilaian berikutnya (tugas yang sama).
function catatKoreksiGuru(tugasId, soal) {
  const t = daftarTugas.find((x) => x.id === tugasId);
  if (!t) return;
  const baru = soal.filter((s) => s.jenis !== 'pg' && s.skorAI != null && Math.abs(s.skor - s.skorAI) >= 0.5)
    .map((s) => ({ no: s.no, jawaban: String(s.jawaban).slice(0, 300), skorAI: s.skorAI, skorGuru: s.skor, maks: s.maks }));
  if (!baru.length) return;
  t.contohGuru = [...(t.contohGuru || []), ...baru].slice(-30);
  simpan.taruh('pt_tugas', daftarTugas);
}

/* ---------- kelas & siswa ---------- */
const kelasById = (id) => daftarKelas.find((k) => k.id === id);
const simpanKelas = () => simpan.taruh('pt_kelas', daftarKelas);
const nilaiSiswa = (tugasId, siswaId) => daftarNilai.find((n) => n.tugasId === tugasId && n.siswaId === siswaId);
function normNama(s) { return String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim(); }
function cocokNama(kelas, teks) {
  const q = normNama(teks); if (!q || !kelas) return null;
  let terbaik = null, skor = 0;
  for (const s of kelas.siswa) {
    const n = normNama(s.nama);
    if (n === q) return s;
    const a = new Set(q.split(' ')), b = n.split(' ');
    const sama = b.filter((w) => a.has(w)).length / Math.max(b.length, a.size);
    if (sama > skor) { skor = sama; terbaik = s; }
  }
  return skor >= 0.5 ? terbaik : null;
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
  if (!daftarTugas.length) sel.append(el('option', { value: '' }, 'Belum ada tugas, buat di tab Tugas'));
  else {
    for (const t of daftarTugas) sel.append(el('option', { value: t.id }, t.judul + (t.kelas ? ' · ' + t.kelas : '')));
    if (daftarTugas.some((t) => t.id === dipilih)) sel.value = dipilih;
  }
  const sk = $('#n-kelas-pilih'), lamaK = sk.value || simpan.ambil('pt_kelas_terakhir', '');
  sk.replaceChildren(el('option', { value: '' }, daftarKelas.length ? '— Tanpa daftar siswa —' : 'Belum ada daftar kelas'),
    ...daftarKelas.slice().sort((a, b) => urutNama(a.nama, b.nama)).map((k) => el('option', { value: k.id }, k.nama + ' (' + k.siswa.length + ' siswa)')));
  if (kelasById(lamaK)) sk.value = lamaK;
  else {
    const t = daftarTugas.find((x) => x.id === sel.value);
    const k = t && t.kelas ? daftarKelas.find((x) => x.nama.toLowerCase() === t.kelas.toLowerCase()) : null;
    if (k) sk.value = k.id; else if (daftarKelas.length === 1) sk.value = daftarKelas[0].id;
  }
  renderSiswaPilih();
  renderFoto();
}

function renderSiswaPilih(pilihId) {
  const k = kelasById($('#n-kelas-pilih').value), tid = $('#n-tugas').value;
  $('#n-siswa-wrap').hidden = !k;
  $('#n-manual').hidden = !!k;
  if (!k) return;
  const ss = $('#n-siswa'), lama = pilihId ?? ss.value;
  const urut = k.siswa.slice().sort((a, b) => (a.no || 999) - (b.no || 999) || urutNama(a.nama, b.nama));
  ss.replaceChildren(el('option', { value: '' }, '— Baca nama dari foto —'),
    ...urut.map((s) => { const n = nilaiSiswa(tid, s.id); return el('option', { value: s.id }, (s.no ? s.no + '. ' : '') + s.nama + (n ? '  ✓ ' + n.nilai : '')); }));
  if (k.siswa.some((s) => s.id === lama)) ss.value = lama;
  else { const belum = urut.find((s) => !nilaiSiswa(tid, s.id)); ss.value = belum ? belum.id : ''; }
}
$('#n-kelas-pilih').addEventListener('change', (e) => { simpan.taruh('pt_kelas_terakhir', e.target.value); renderSiswaPilih(''); });

const IKON_KAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const IKON_GALERI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';
function tombolFoto(labelKamera) {
  const k = el('button', { class: fotoSiswa.length ? 'garis' : 'utama', onclick: () => $('#n-kamera').click() }); k.innerHTML = IKON_KAMERA; k.append(labelKamera);
  const g = el('button', { class: 'garis', onclick: () => $('#n-file').click() }); g.innerHTML = IKON_GALERI; g.append('Galeri');
  return el('div', { class: 'dua' }, k, g);
}
function renderFoto() {
  const w = $('#n-foto-wrap');
  if (!fotoSiswa.length) {
    w.replaceChildren(el('div', { class: 'kosong' },
      el('div', {}, 'Foto lembar jawaban siswa. Satu siswa boleh beberapa halaman.'),
      tombolFoto('Kamera')));
  } else {
    w.replaceChildren(
      el('div', { class: 'foto-grid' },
        fotoSiswa.map((f, i) => el('div', { class: 'foto' },
          el('img', { src: f.dataUrl, alt: 'Halaman ' + (i + 1) }),
          el('button', { 'aria-label': 'Hapus halaman ' + (i + 1), onclick: () => { fotoSiswa.splice(i, 1); renderFoto(); } }, '×')))),
      tombolFoto('Halaman berikutnya'));
  }
  $('#n-nilai').disabled = sedangMenilai || !fotoSiswa.length || !daftarTugas.length;
}

async function tambahFoto(files) {
  for (const f of files) {
    try { fotoSiswa.push(await kecilkanFoto(f)); } catch (err) { toast(err.message); }
  }
  renderFoto();
}
$('#n-file').addEventListener('change', async (e) => { const f = [...e.target.files]; e.target.value = ''; await tambahFoto(f); });
$('#n-kamera').addEventListener('change', async (e) => { const f = [...e.target.files]; e.target.value = ''; await tambahFoto(f); });
$('#n-tugas').addEventListener('change', (e) => {
  simpan.taruh('pt_tugas_terakhir', e.target.value);
  const t = daftarTugas.find((x) => x.id === e.target.value);
  if (t && t.kelas && !t.kelas.includes(',')) {
    $('#n-kelas').value = t.kelas;
    const k = daftarKelas.find((x) => x.nama.toLowerCase() === t.kelas.toLowerCase());
    if (k) { $('#n-kelas-pilih').value = k.id; simpan.taruh('pt_kelas_terakhir', k.id); }
  }
  renderSiswaPilih('');
});

$('#n-nilai').addEventListener('click', async () => {
  const tugas = daftarTugas.find((t) => t.id === $('#n-tugas').value);
  if (!tugas) return toast('Pilih tugas dulu');
  const soal = parseKunci(tugas.kunci);
  if (!soal.length) return toast('Kunci jawaban tugas ini belum berisi nomor soal. Periksa di tab Tugas.');
  const kelas = kelasById($('#n-kelas-pilih').value);
  const siswa = kelas ? kelas.siswa.find((s) => s.id === $('#n-siswa').value) : null;
  const namaManual = kelas ? '' : $('#n-nama').value.trim();
  sedangMenilai = true;
  renderFoto();
  $('#n-hasil').hidden = true;
  try {
    memuat($('#n-status'), `Langkah 1 dari 2: membaca jawaban ${soal.length} soal…`);
    const baca = await gemini(promptBaca(soal, !siswa && !namaManual), fotoSiswa, SKEMA_BACA);
    const jawabanMap = {}, yakinMap = {};
    for (const j of baca.jawaban || []) { const s = soal.find((x) => normNo(x.no) === normNo(j.no)); if (s) { jawabanMap[s.no] = String(j.jawaban ?? ''); yakinMap[s.no] = j.yakin !== false; } }
    memuat($('#n-status'), 'Langkah 2 dari 2: menilai jawaban…');
    const h = await nilaiDariJawaban(tugas, soal, jawabanMap, yakinMap);
    let s = siswa;
    if (!s && kelas && baca.nama) s = cocokNama(kelas, baca.nama);
    hasilSekarang = {
      id: idBaru(), tugasId: tugas.id,
      siswaId: s ? s.id : null,
      nama: s ? s.nama : (namaManual || String(baca.nama || '').trim()),
      kelas: kelas ? kelas.nama : ($('#n-kelas').value.trim() || String(baca.kelas || '').trim()),
      soal: h.soal, komentar: h.komentar,
    };
    pesan($('#n-status'), '');
    const lama = s ? nilaiSiswa(tugas.id, s.id) : null;
    tampilkanEditor($('#n-hasil'), hasilSekarang, {
      judul: 'Hasil penilaian',
      info: lama ? `Siswa ini sudah punya nilai ${lama.nilai} untuk tugas ini. Menyimpan akan menggantinya.` : '',
      onBuang: () => { hasilSekarang = null; $('#n-hasil').hidden = true; },
      onSimpan: simpanHasilBaru,
    });
    $('#n-hasil').hidden = false;
    $('#n-hasil').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    pesan($('#n-status'), err.message, 'err');
  } finally {
    sedangMenilai = false;
    renderFoto();
  }
});

function simpanHasilBaru(h) {
  if (!h.nama.trim()) { toast('Isi nama siswa dulu'); return false; }
  const t = hitung(h.soal);
  const rec = { ...h, nama: h.nama.trim(), kelas: h.kelas.trim(), skor: t.skor, maks: t.maks, nilai: t.nilai, waktu: Date.now() };
  const lama = rec.siswaId ? daftarNilai.findIndex((n) => n.tugasId === rec.tugasId && n.siswaId === rec.siswaId) : -1;
  const cadangan = daftarNilai.slice();
  if (lama >= 0) daftarNilai.splice(lama, 1);
  daftarNilai.unshift(rec);
  if (!simpan.taruh('pt_nilai', daftarNilai)) { daftarNilai = cadangan; return false; }
  catatKoreksiGuru(rec.tugasId, rec.soal);
  toast(`Tersimpan: ${rec.nama} mendapat ${rec.nilai}`);
  hasilSekarang = null;
  fotoSiswa = [];
  $('#n-nama').value = '';
  $('#n-hasil').hidden = true;
  renderSiswaPilih(''); // pilih siswa berikutnya yang belum dinilai
  const berikut = $('#n-siswa').selectedOptions[0];
  pesan($('#n-status'), `Nilai ${rec.nama} tersimpan (${rec.nilai}).` + (berikut && berikut.value ? ` Berikutnya: ${berikut.textContent.trim()}.` : ' Silakan foto siswa berikutnya.'), 'ok');
  renderFoto();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return true;
}

/* ---------- editor nilai (dipakai di tab Nilai dan saat mengubah nilai) ---------- */
function tampilkanEditor(box, h, o) {
  const total = el('div', { class: 'lingkar' });
  const ket = el('div', { class: 'kecil' });
  const segarkan = () => { const t = hitung(h.soal); total.textContent = t.nilai; ket.textContent = `Skor ${fmtAngka(t.skor)} dari ${fmtAngka(t.maks)} poin`; };
  const inNama = el('input', { value: h.nama, placeholder: 'Nama siswa', oninput: (e) => { h.nama = e.target.value; } });
  const inKelas = el('input', { value: h.kelas, placeholder: 'Kelas', oninput: (e) => { h.kelas = e.target.value; } });
  const ragu = h.soal.filter((s) => s.ragu).length;

  const rows = h.soal.map((s, i) => {
    const st = () => (s.ragu ? 'cek' : s.maks && s.skor >= s.maks ? 'benar' : s.skor > 0 ? 'sebagian' : 'salah');
    const chip = el('span', { class: 'chip st-' + st() }, s.ragu ? 'periksa' : s.jenis);
    const inp = el('input', {
      type: 'number', inputmode: 'decimal', min: 0, max: s.maks, step: '0.5', value: s.skor, 'aria-label': 'Skor soal ' + s.no,
      oninput: (e) => {
        let v = Number(String(e.target.value).replace(',', '.'));
        if (!isFinite(v)) v = 0;
        s.skor = Math.min(s.maks, Math.max(0, v));
        s.ragu = false; chip.className = 'chip st-' + st(); chip.textContent = s.jenis; segarkan();
      },
    });
    const jw = el('input', { value: s.jawaban, 'aria-label': 'Jawaban soal ' + s.no, style: 'padding:6px 8px;font-size:13.5px', oninput: (e) => { s.jawaban = e.target.value; } });
    return el('div', { class: 'soal' },
      el('div', { class: 'no' }, s.no),
      el('div', { class: 'isi' }, el('div', { style: 'display:flex;align-items:center;gap:6px' }, chip, jw), s.catatan ? el('div', { class: 'kecil' }, s.catatan) : null),
      el('div', { class: 'skor' }, inp, el('span', { class: 'kecil' }, '/' + fmtAngka(s.maks))));
  });

  const inKomentar = el('textarea', { style: 'min-height:70px;font-family:inherit;background-image:none', oninput: (e) => { h.komentar = e.target.value; } });
  inKomentar.value = h.komentar || '';
  const status = el('div');
  const tombol = [el('button', { class: 'garis', onclick: () => o.onBuang && o.onBuang() }, o.labelBuang || 'Buang')];
  if (o.onNilaiUlang) tombol.push(el('button', { class: 'garis', onclick: async () => { memuat(status, 'Menilai ulang dengan kunci terbaru…'); try { await o.onNilaiUlang(); } catch (e) { pesan(status, e.message, 'err'); } } }, 'Nilai ulang'));
  if (o.onCetak) tombol.push(el('button', { class: 'garis', onclick: () => o.onCetak(h) }, 'Cetak'));
  tombol.push(el('button', { class: 'utama', onclick: () => o.onSimpan(h) }, 'Simpan nilai'));

  box.replaceChildren(
    o.kepala || '',
    el('div', { class: 'nilai-besar' }, total, el('div', {}, el('h2', {}, o.judul), ket,
      el('div', { class: 'kecil' }, ragu ? `${ragu} soal ditandai "periksa": cek dulu sebelum menyimpan.` : 'Periksa lalu ubah skor atau jawaban jika perlu.'))),
    o.info ? el('div', { class: 'pesan' }, o.info) : '',
    el('div', { class: 'baris' }, el('label', {}, 'Nama', inNama), el('label', {}, 'Kelas', inKelas)),
    el('div', {}, rows),
    el('label', {}, 'Komentar untuk siswa', inKomentar),
    status,
    el('div', { class: 'baris' }, tombol),
  );
  segarkan();
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
    const soal = parseKunci(t.kunci), maks = soal.reduce((a, s) => a + s.maks, 0);
    const hapus = tombolYakin('Hapus', () => {
      daftarTugas = daftarTugas.filter((x) => x.id !== t.id);
      simpan.taruh('pt_tugas', daftarTugas);
      renderTugas();
      toast('Tugas dihapus. Nilai yang sudah ada tetap tersimpan.');
    });
    return el('div', { class: 'item' },
      el('div', { class: 'tengah' },
        el('div', { class: 'judul' }, t.judul),
        el('div', { class: 'kecil' }, [t.mapel, t.kelas, soal.length + ' soal · ' + fmtAngka(maks) + ' poin', jml + ' siswa dinilai'].filter(Boolean).join(' · '))),
      el('button', { class: 'teks', onclick: () => editTugas(t) }, 'Ubah'),
      hapus);
  }));
}

function ringkasKunci() {
  const soal = parseKunci($('#t-kunci').value);
  const st = $('#t-status');
  if (!$('#t-kunci').value.trim()) { pesan(st, ''); return; }
  if (!soal.length) { pesan(st, 'Belum ada nomor soal yang terbaca. Awali tiap baris dengan nomor, mis. "1. B".', 'err'); return; }
  const per = {}; soal.forEach((s) => { per[s.jenis] = (per[s.jenis] || 0) + 1; });
  const label = { pg: 'pilihan ganda', isian: 'isian', esai: 'esai', pendapat: 'pendapat' };
  pesan(st, `Terbaca ${soal.length} soal (${Object.entries(per).map(([k, v]) => v + ' ' + label[k]).join(', ')}), total ${fmtAngka(soal.reduce((a, s) => a + s.maks, 0))} poin.`, 'ok');
}
$('#t-kunci').addEventListener('input', () => { clearTimeout(ringkasKunci.t); ringkasKunci.t = setTimeout(ringkasKunci, 400); });

function editTugas(t) {
  tugasDiedit = t ? t.id : null;
  $('#t-judul').value = t ? t.judul : '';
  $('#t-mapel').value = t ? t.mapel : '';
  $('#t-kelas').value = t ? t.kelas : '';
  $('#t-kunci').value = t ? t.kunci : '';
  $('#t-judul-form').textContent = t ? 'Ubah tugas' : 'Tugas baru';
  $('#t-batal').hidden = !t;
  pesan($('#t-status'), '');
  if (t) ringkasKunci();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#t-batal').addEventListener('click', () => editTugas(null));
$('#t-contoh').addEventListener('click', () => {
  if (!$('#t-judul').value) $('#t-judul').value = 'Ulangan Harian Fotosintesis';
  if (!$('#t-mapel').value) $('#t-mapel').value = 'IPA';
  $('#t-kunci').value = CONTOH_KUNCI;
  ringkasKunci();
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
  if (!parseKunci(data.kunci).length) return pesan($('#t-status'), 'Belum ada nomor soal yang terbaca. Awali tiap baris dengan nomor, mis. "1. B".', 'err');
  if (tugasDiedit) daftarTugas = daftarTugas.map((t) => (t.id === tugasDiedit ? { ...t, ...data } : t));
  else {
    const baru = { id: idBaru(), dibuat: Date.now(), contohGuru: [], ...data };
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
  memuat(st, 'Membaca kunci jawaban dari foto…');
  try {
    const foto = [];
    for (const f of files) foto.push(await kecilkanFoto(f));
    const h = await gemini(`Foto terlampir adalah lembar soal dan/atau kunci jawaban milik guru. Tuliskan ulang kunci jawabannya, satu soal per baris, dengan format:
- Pilihan ganda: "1. B"
- Isian singkat: "5. (isian) jawaban"
- Esai: "7. (esai, N poin) ringkasan pertanyaan. Poin kunci jawaban: ..."
- Pendapat: "8. (pendapat, N poin) ringkasan pertanyaan. Nilai dari alasan."
Jika poin tidak tertulis, jangan tulis poin. Jika kunci pilihan ganda tidak ada di foto, kosongkan hurufnya. Balas JSON.`, foto,
    { type: 'OBJECT', properties: { judul: { type: 'STRING' }, mapel: { type: 'STRING' }, kunci: { type: 'STRING' } }, required: ['kunci'] });
    if (!h.kunci) throw new Error('Kunci jawaban tidak ditemukan di foto.');
    $('#t-kunci').value = String(h.kunci).trim();
    if (!$('#t-judul').value && h.judul) $('#t-judul').value = h.judul;
    if (!$('#t-mapel').value && h.mapel) $('#t-mapel').value = h.mapel;
    ringkasKunci();
    toast('Kunci terbaca. Periksa dan perbaiki bila perlu, lalu simpan.');
  } catch (err) {
    pesan(st, err.message, 'err');
  }
});

/* ======================================================
   TAB KELAS
   ====================================================== */
let kelasDibuka = null;

function renderKelas() {
  const d = $('#k-daftar');
  if (!daftarKelas.length) d.replaceChildren(el('div', { class: 'kosong' }, 'Belum ada kelas. Tambahkan kelas, lalu isi daftar siswanya dengan menempel nama atau impor dari Excel.'));
  else d.replaceChildren(...daftarKelas.slice().sort((a, b) => urutNama(a.nama, b.nama)).map((k) => el('div', { class: 'item' },
    el('div', { class: 'tengah' }, el('div', { class: 'judul' }, k.nama), el('div', { class: 'kecil' }, k.siswa.length + ' siswa')),
    el('button', { class: 'teks', onclick: () => { kelasDibuka = k.id; renderDetailKelas(); $('#k-detail').scrollIntoView({ behavior: 'smooth' }); } }, 'Buka'))));
  renderDetailKelas();
}
$('#k-tambah').addEventListener('click', () => {
  const nama = $('#k-nama').value.trim();
  if (!nama) return toast('Isi nama kelas dulu');
  if (daftarKelas.some((k) => k.nama.toLowerCase() === nama.toLowerCase())) return toast('Kelas ' + nama + ' sudah ada');
  const k = { id: idBaru(), nama, siswa: [] };
  daftarKelas.push(k); simpanKelas();
  $('#k-nama').value = ''; kelasDibuka = k.id; renderKelas();
  $('#k-detail').scrollIntoView({ behavior: 'smooth' });
});

function tambahSiswa(k, baris) {
  let n = 0;
  const ada = new Set(k.siswa.map((s) => normNama(s.nama)));
  let urut = Math.max(0, ...k.siswa.map((s) => s.no || 0));
  for (let b of baris) {
    b = String(b || '').replace(/\t/g, ' ').trim();
    if (!b) continue;
    const m = b.match(/^(\d{1,3})\s*[.)\-]?\s+(.+)$/);
    const nama = (m ? m[2] : b).replace(/\s+/g, ' ').trim();
    if (nama.length < 2 || /^nama( siswa)?$/i.test(nama) || ada.has(normNama(nama))) continue;
    urut = m ? Math.max(urut, +m[1]) : urut + 1;
    k.siswa.push({ id: idBaru(), no: m ? +m[1] : urut, nama });
    ada.add(normNama(nama)); n++;
  }
  simpanKelas();
  return n;
}

function renderDetailKelas() {
  const box = $('#k-detail'), k = kelasById(kelasDibuka);
  if (!k) { box.hidden = true; return; }
  box.hidden = false;
  const tempel = el('textarea', { placeholder: 'Tempel daftar nama, satu per baris:\n1. Ahmad Fauzi\n2. Bunga Lestari\n…', style: 'min-height:120px' });
  const urut = k.siswa.slice().sort((a, b) => (a.no || 999) - (b.no || 999) || urutNama(a.nama, b.nama));
  const daftar = urut.length ? el('div', { class: 'siswa-list' }, urut.map((s) => {
    const inNo = el('input', { type: 'number', value: s.no || '', style: 'width:64px;padding:6px 8px', 'aria-label': 'Nomor absen', onchange: (e) => { s.no = +e.target.value || null; simpanKelas(); } });
    const inNama = el('input', { value: s.nama, style: 'padding:6px 8px', 'aria-label': 'Nama siswa', onchange: (e) => {
      const v = e.target.value.trim(); if (v.length < 2) { e.target.value = s.nama; return; }
      s.nama = v; simpanKelas();
      daftarNilai.forEach((n) => { if (n.siswaId === s.id) n.nama = v; }); simpan.taruh('pt_nilai', daftarNilai);
    } });
    return el('div', { class: 'item' }, inNo, el('div', { class: 'tengah' }, inNama),
      tombolYakin('Hapus', () => { k.siswa = k.siswa.filter((x) => x.id !== s.id); simpanKelas(); renderDetailKelas(); renderKelas(); }));
  })) : el('div', { class: 'kosong' }, 'Belum ada siswa di kelas ini.');

  box.replaceChildren(
    el('div', { class: 'dlg-head' }, el('h2', {}, 'Kelas'), el('span', { class: 'kecil' }, k.siswa.length + ' siswa')),
    el('label', {}, 'Nama kelas', el('input', { value: k.nama, onchange: (e) => {
      const v = e.target.value.trim(); if (!v) { e.target.value = k.nama; return; }
      const lama = k.nama; k.nama = v; simpanKelas();
      daftarNilai.forEach((n) => { if (n.kelas === lama && k.siswa.some((s) => s.id === n.siswaId)) n.kelas = v; });
      simpan.taruh('pt_nilai', daftarNilai); renderKelas(); toast('Nama kelas diganti');
    } })),
    el('label', {}, 'Tambah siswa', tempel),
    el('div', { class: 'dua' },
      el('button', { class: 'utama', onclick: () => { const n = tambahSiswa(k, tempel.value.split(/\r?\n/)); toast(n ? n + ' siswa ditambahkan' : 'Tidak ada nama baru'); renderKelas(); } }, 'Tambahkan'),
      el('button', { class: 'garis', onclick: () => $('#k-file').click() }, 'Impor Excel / CSV')),
    el('p', { class: 'kecil' }, 'Impor Excel: kolom berjudul "Nama" (dan "No" bila ada) dibaca otomatis; tanpa judul, kolom pertama dianggap nama.'),
    daftar,
    el('div', { class: 'baris' },

      tombolYakin('Hapus kelas', () => { daftarKelas = daftarKelas.filter((x) => x.id !== k.id); simpanKelas(); kelasDibuka = null; renderKelas(); toast('Kelas dihapus. Nilai yang sudah ada tetap tersimpan.'); })),
  );
}

$('#k-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  const k = kelasById(kelasDibuka); if (!f || !k) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
    if (!rows.length) throw new Error('File kosong');
    const head = rows[0].map((x) => String(x).toLowerCase().trim());
    let iNama = head.findIndex((h) => /^nama/.test(h)), iNo = head.findIndex((h) => /^(no|nomor|absen)/.test(h)), mulai = 1;
    if (iNama < 0) { iNama = 0; iNo = -1; mulai = 0; if (rows[0].length > 1 && /^\d+$/.test(String(rows[0][0]).trim())) { iNo = 0; iNama = 1; } }
    const baris = rows.slice(mulai).map((r) => (iNo >= 0 && String(r[iNo]).trim() ? String(r[iNo]).trim() + '. ' : '') + String(r[iNama] || '').trim());
    const n = tambahSiswa(k, baris);
    toast(n ? n + ' siswa diimpor dari ' + f.name : 'Tidak ada nama baru di file itu');
    renderKelas();
  } catch (err) { toast('Gagal membaca file: ' + err.message); }
});

/* ======================================================
   TAB REKAP
   ====================================================== */
function nilaiTersaring() {
  const k = $('#r-kelas').value, t = $('#r-tugas').value;
  return daftarNilai.filter((n) => (!k || n.kelas === k) && (!t || n.tugasId === t));
}
const tugasById = (id) => daftarTugas.find((t) => t.id === id);
const namaTugas = (id) => tugasById(id)?.judul || '(tugas dihapus)';
const mapelTugas = (id) => tugasById(id)?.mapel || '';

function isiPilihan(sel, opsi, labelSemua) {
  const lama = sel.value;
  sel.replaceChildren(el('option', { value: '' }, labelSemua), ...opsi.map(([v, l]) => el('option', { value: v }, l)));
  if (opsi.some(([v]) => v === lama)) sel.value = lama;
}
const urutRekap = (a, b) => urutNama(a.kelas, b.kelas) || urutNama(a.nama, b.nama);

function renderRekap() {
  const kelas = [...new Set([...daftarNilai.map((n) => n.kelas), ...daftarKelas.map((k) => k.nama)].filter(Boolean))].sort(urutNama);
  isiPilihan($('#r-kelas'), kelas.map((k) => [k, k]), 'Semua kelas');
  const idTugas = [...new Set([...daftarNilai.map((n) => n.tugasId), ...daftarTugas.map((t) => t.id)])];
  isiPilihan($('#r-tugas'), idTugas.map((id) => [id, namaTugas(id)]), 'Semua tugas');

  const data = nilaiTersaring().slice().sort(urutRekap);
  const rata = data.length ? data.reduce((a, n) => a + n.nilai, 0) / data.length : 0;
  $('#r-ringkas').replaceChildren(
    el('div', {}, el('b', {}, data.length), el('span', {}, 'siswa')),
    el('div', {}, el('b', {}, data.length ? fmtAngka(Math.round(rata * 10) / 10) : '–'), el('span', {}, 'rata-rata')),
    el('div', {}, el('b', {}, data.length ? Math.max(...data.map((n) => n.nilai)) : '–'), el('span', {}, 'tertinggi')));

  // siswa yang belum dinilai (bila kelas & tugas dipilih)
  const kSel = daftarKelas.find((k) => k.nama === $('#r-kelas').value), tSel = $('#r-tugas').value;
  const belum = kSel && tSel ? kSel.siswa.filter((s) => !nilaiSiswa(tSel, s.id)).sort((a, b) => (a.no || 999) - (b.no || 999)) : [];
  $('#r-belum').textContent = belum.length ? `Belum dinilai (${belum.length}): ` + belum.map((s) => s.nama).join(', ') : (kSel && tSel ? 'Semua siswa ' + kSel.nama + ' sudah dinilai untuk tugas ini.' : '');

  const tabel = $('#r-tabel');
  $('#r-excel').disabled = $('#r-cetak').disabled = !data.length;
  if (!data.length) {
    tabel.replaceChildren(el('tr', {}, el('td', { class: 'kecil' }, 'Belum ada nilai. Nilai tersimpan dari tab Nilai akan muncul di sini.')));
    return;
  }
  tabel.replaceChildren(
    el('thead', {}, el('tr', {}, el('th', {}, 'Nama'), el('th', {}, 'Kelas'), el('th', { class: 'angka' }, 'Nilai'), el('th', {}, 'Tugas'), el('th', {}, ''))),
    el('tbody', {}, data.map((n) => {
      const ragu = (n.soal || []).filter((s) => s.ragu).length;
      const hapus = tombolYakin('Hapus', () => { daftarNilai = daftarNilai.filter((x) => x.id !== n.id); simpan.taruh('pt_nilai', daftarNilai); renderRekap(); });
      const tr = el('tr', { class: 'klik' },
        el('td', {}, n.nama, ragu ? el('span', { class: 'chip st-cek', style: 'margin-left:6px' }, ragu + ' periksa') : ''), el('td', {}, n.kelas || '–'),
        el('td', { class: 'angka' }, el('b', {}, n.nilai)), el('td', {}, namaTugas(n.tugasId)), el('td', {}, hapus));
      tr.addEventListener('click', (e) => { if (!e.target.closest('button')) bukaEdit(n.id); });
      return tr;
    })));
}
$('#r-kelas').addEventListener('change', renderRekap);
$('#r-tugas').addEventListener('change', renderRekap);

/* ---------- ubah nilai yang sudah tersimpan ---------- */
function bukaEdit(id) {
  const asli = daftarNilai.find((n) => n.id === id);
  if (!asli) return;
  const h = JSON.parse(JSON.stringify(asli));
  const d = $('#edit'), box = $('#edit-isi');
  const tutup = () => d.close();
  const render = () => tampilkanEditor(box, h, {
    judul: 'Ubah nilai',
    kepala: el('div', { class: 'dlg-head' }, el('div', { class: 'kecil' }, namaTugas(h.tugasId) + ' · dinilai ' + fmtTgl(h.waktu)), el('button', { class: 'garis', 'aria-label': 'Tutup', onclick: tutup }, '×')),
    labelBuang: 'Batal',
    onBuang: tutup,
    onCetak: (x) => cetak([{ ...x, ...hitung(x.soal) }]),
    onNilaiUlang: async () => {
      const t = tugasById(h.tugasId); if (!t) throw new Error('Tugasnya sudah dihapus, tidak bisa dinilai ulang.');
      const soal = parseKunci(t.kunci), jw = {}, yk = {};
      for (const s of soal) { const lama = h.soal.find((x) => normNo(x.no) === normNo(s.no)); jw[s.no] = lama ? lama.jawaban : ''; yk[s.no] = true; }
      const r = await nilaiDariJawaban(t, soal, jw, yk);
      h.soal = r.soal; if (!h.komentar) h.komentar = r.komentar;
      render(); toast('Dinilai ulang dengan kunci terbaru. Periksa lalu simpan.');
    },
    onSimpan: (x) => {
      if (!x.nama.trim()) { toast('Isi nama siswa dulu'); return; }
      const t = hitung(x.soal);
      Object.assign(asli, x, { nama: x.nama.trim(), kelas: x.kelas.trim(), skor: t.skor, maks: t.maks, nilai: t.nilai, diubah: Date.now() });
      simpan.taruh('pt_nilai', daftarNilai);
      catatKoreksiGuru(asli.tugasId, asli.soal);
      tutup(); renderRekap(); toast(`Nilai ${asli.nama} diperbarui: ${asli.nilai}`);
    },
  });
  render();
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

/* ---------- cetak hasil koreksi ---------- */
function htmlKoreksi(list) {
  const halaman = list.map((n) => {
    const t = tugasById(n.tugasId);
    const baris = (n.soal || []).map((s) => {
      const tanda = s.skor >= s.maks && s.maks > 0 ? '✓' : s.skor > 0 ? '½' : '✗';
      return `<tr><td class="c">${esc(s.no)}</td><td>${esc(s.jawaban || '(kosong)')}</td><td class="c tanda t${tanda === '✓' ? 'b' : tanda === '✗' ? 's' : 'p'}">${tanda}</td><td class="c">${fmtAngka(s.skor)}/${fmtAngka(s.maks)}</td><td class="cat">${esc(s.catatan || '')}</td></tr>`;
    }).join('');
    return `<section class="hal">
  <header><div><div class="sek">${esc(setelan.sekolah || 'Hasil Koreksi')}</div><h1>${esc(t ? t.judul : 'Tugas')}</h1><div class="meta">${esc([t && t.mapel, n.kelas && 'Kelas ' + n.kelas].filter(Boolean).join(' · '))}</div></div>
  <div class="nilai"><b>${n.nilai}</b><span>nilai</span></div></header>
  <table class="id"><tr><td>Nama</td><td><b>${esc(n.nama)}</b></td><td>Skor</td><td>${fmtAngka(n.skor)} dari ${fmtAngka(n.maks)} poin</td></tr>
  <tr><td>Kelas</td><td>${esc(n.kelas || '–')}</td><td>Tanggal</td><td>${esc(fmtTgl(n.waktu))}</td></tr></table>
  <table class="soal"><thead><tr><th>No</th><th>Jawaban siswa</th><th></th><th>Skor</th><th>Catatan</th></tr></thead><tbody>${baris}</tbody></table>
  ${n.komentar ? `<div class="kom"><b>Catatan guru:</b> ${esc(n.komentar)}</div>` : ''}
  <div class="ttd"><div>Paraf orang tua/wali<div class="garis"></div></div><div>${esc(setelan.guru ? 'Guru mata pelajaran' : 'Guru')}<div class="garis"></div>${esc(setelan.guru || '')}</div></div>
</section>`;
  }).join('');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Hasil koreksi</title><style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}body{margin:0;font:11pt/1.4 "Segoe UI",Roboto,Arial,sans-serif;color:#111}
.hal{page-break-after:always;break-after:page}.hal:last-child{page-break-after:auto;break-after:auto}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
.sek{font-size:10pt;color:#444;text-transform:uppercase;letter-spacing:.06em}h1{margin:2px 0;font-size:16pt}.meta{color:#444}
.nilai{width:70px;height:70px;border:3px solid #c62828;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#c62828;transform:rotate(-6deg)}
.nilai b{font-size:22pt;line-height:1}.nilai span{font-size:8pt}
table{width:100%;border-collapse:collapse}table.id td{padding:3px 6px}table.id td:nth-child(odd){color:#555;width:70px}
table.soal{margin-top:10px}table.soal th,table.soal td{border:1px solid #999;padding:5px 6px;vertical-align:top}table.soal th{background:#eee;font-size:9.5pt;text-align:left}
td.c{text-align:center;white-space:nowrap}td.cat{font-size:9.5pt;color:#333}.tanda{font-weight:700;font-size:13pt}.tb{color:#1b7a3d}.ts{color:#c62828}.tp{color:#a36a00}
tr{page-break-inside:avoid}
.kom{margin-top:10px;padding:8px 10px;border:1px solid #999;border-radius:6px}
.ttd{display:flex;justify-content:space-between;margin-top:28px;font-size:10pt}.ttd>div{width:42%;text-align:center}.ttd .garis{height:48px;border-bottom:1px solid #111;margin-bottom:4px}
</style></head><body>${halaman}</body></html>`;
}
function cetak(list) {
  if (!list.length) return;
  const html = htmlKoreksi(list);
  const judul = list.length === 1 ? 'Koreksi ' + list[0].nama : 'Koreksi ' + list.length + ' siswa';
  if (window.AndroidApp?.printHtml) { window.AndroidApp.printHtml(html, judul); return; }
  const f = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' });
  document.body.append(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('Browser ini tidak bisa mencetak'); } setTimeout(() => f.remove(), 2000); }, 300);
}
$('#r-cetak').addEventListener('click', () => {
  const data = nilaiTersaring().slice().sort(urutRekap);
  if (!data.length) return;
  cetak(data);
});

$('#r-excel').addEventListener('click', () => {
  const data = nilaiTersaring().slice().sort(urutRekap);
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
  ws1['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 8 }, { wch: 28 }, { wch: 12 }, { wch: 6 }, { wch: 9 }, { wch: 6 }, { wch: 16 }, { wch: 50 }];
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
  sel.replaceChildren(...semua.map((m) => el('option', { value: m }, m + (/pro/.test(m) ? ' (paling teliti, kuota gratis kecil)' : /lite/.test(m) ? ' (paling cepat)' : /flash/.test(m) ? ' (disarankan)' : ''))));
  sel.value = setelan.model;
}

function renderSetelan() {
  $('#s-key').value = setelan.apiKey;
  $('#s-sekolah').value = setelan.sekolah || '';
  $('#s-guru').value = setelan.guru || '';
  isiModel(simpan.ambil('pt_model_list', MODEL_BAWAAN));
  const siswa = daftarKelas.reduce((a, k) => a + k.siswa.length, 0);
  $('#s-info').textContent = `${daftarTugas.length} tugas, ${daftarKelas.length} kelas (${siswa} siswa), dan ${daftarNilai.length} nilai tersimpan di HP ini.`;
}
['sekolah', 'guru'].forEach((k) => $('#s-' + k).addEventListener('change', (e) => { setelan[k] = e.target.value.trim(); simpan.taruh('pt_setelan', setelan); toast('Tersimpan'); }));

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
  memuat(st, 'Mengecek API key…');
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
