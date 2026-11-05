# Penilai Tugas

Aplikasi Android untuk guru: foto lembar jawaban siswa, lalu Gemini (Google AI Studio) membaca dan menilainya otomatis.

- Jenis soal: pilihan ganda, isian singkat, esai/uraian, dan pendapat
- Nilai bisa diperiksa dan diubah sebelum disimpan
- Rekap per kelas dan per tugas, unduh sebagai Excel (.xlsx)
- Data tersimpan di HP. Foto tidak disimpan, hanya dikirim ke Gemini untuk dinilai.

## Pasang di HP

1. Buka halaman **Releases** repo ini dari HP, unduh `PenilaiTugas.apk`.
2. Buka file itu. Jika diminta, izinkan "Instal aplikasi tidak dikenal" untuk browser/File Manager.
3. Buka aplikasi, masuk ke tab **Setelan**, tempel API key Gemini dari https://aistudio.google.com/apikey

## Cara pakai

1. **Tugas**: buat tugas dan tulis kunci jawaban, satu soal per baris:
   ```
   1. B
   2. (isian) fotosintesis
   3. (esai, 10 poin) Jelaskan ... Poin kunci: ...
   4. (pendapat, 10 poin) Setujukah kamu ...? Nilai dari alasan.
   ```
   Atau ketuk **Baca kunci dari foto**.
2. **Nilai**: pilih tugas, foto lembar jawaban (boleh beberapa halaman), ketuk **Nilai sekarang**, periksa, lalu **Simpan nilai**.
3. **Rekap**: saring per kelas/tugas, ketuk **Unduh Excel**.

## Build

APK dibuat otomatis oleh GitHub Actions (`.github/workflows/build-apk.yml`) setiap ada perubahan di branch `main`.
Kode tampilan ada di `app/src/main/assets/www/`, pembungkus Android di `app/src/main/java/`.
