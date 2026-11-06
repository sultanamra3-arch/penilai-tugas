package id.sekolah.penilaitugas;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final int REQ_FILE = 41;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private WebView printView; // disimpan supaya tidak dibuang sebelum dicetak

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                // Tautan luar (mis. aistudio.google.com) dibuka di browser HP.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(buildChooser(params), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    toast("Tidak bisa membuka kamera atau galeri");
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidApp");

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(START_URL);
        }
    }

    private Intent buildChooser(WebChromeClient.FileChooserParams params) {
        // File selain gambar (mis. Excel daftar siswa): buka pemilih file biasa.
        String[] accept = params.getAcceptTypes();
        boolean gambar = accept == null || accept.length == 0;
        java.util.ArrayList<String> mimes = new java.util.ArrayList<>();
        if (accept != null) for (String a : accept) {
            if (a == null || a.trim().isEmpty()) { gambar = true; continue; }
            for (String t : a.split(",")) {
                t = t.trim().toLowerCase();
                if (t.startsWith("image")) gambar = true;
                else if (t.equals(".xlsx")) mimes.add("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                else if (t.equals(".xls")) mimes.add("application/vnd.ms-excel");
                else if (t.equals(".csv")) { mimes.add("text/csv"); mimes.add("text/comma-separated-values"); mimes.add("text/plain"); }
                else if (t.contains("/")) mimes.add(t);
            }
        }
        if (!gambar) {
            Intent doc = new Intent(Intent.ACTION_GET_CONTENT);
            doc.addCategory(Intent.CATEGORY_OPENABLE);
            doc.setType("*/*");
            if (!mimes.isEmpty()) doc.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
            cameraUri = null;
            return Intent.createChooser(doc, "Pilih file");
        }
        Intent camera = null;
        try {
            File dir = new File(getCacheDir(), "foto");
            if (!dir.exists()) dir.mkdirs();
            File photo = new File(dir, "foto_" + System.currentTimeMillis() + ".jpg");
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photo);
            camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            camera.setClipData(ClipData.newRawUri("foto", cameraUri));
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            cameraUri = null;
        }

        if (params.isCaptureEnabled() && camera != null) return camera;

        Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
        gallery.addCategory(Intent.CATEGORY_OPENABLE);
        gallery.setType("image/*");
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            gallery.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        Intent chooser = Intent.createChooser(gallery, "Ambil foto lembar jawaban");
        if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        return chooser;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;

        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getClipData() != null && data.getData() == null
                    && !isCameraClip(data.getClipData())) {
                ClipData clip = data.getClipData();
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            } else if (cameraUri != null) {
                result = new Uri[]{cameraUri};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    private boolean isCameraClip(ClipData clip) {
        return cameraUri != null && clip.getItemCount() == 1 && cameraUri.equals(clip.getItemAt(0).getUri());
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.kembali ? window.kembali() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    /** Dipanggil dari JavaScript sebagai window.AndroidApp. */
    private class Bridge {
        @JavascriptInterface
        public void printHtml(final String html, final String title) {
            runOnUiThread(() -> {
                final String job = (title == null || title.trim().isEmpty()) ? "Hasil koreksi" : title;
                WebView pv = new WebView(MainActivity.this);
                pv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                        if (pm == null) { toast("Fitur cetak tidak tersedia di HP ini"); return; }
                        pm.print(job, view.createPrintDocumentAdapter(job),
                                new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                    }
                });
                printView = pv;
                pv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            });
        }

        @JavascriptInterface
        public String saveFile(String filename, String base64, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String where;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("gagal membuat file");
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        os.write(bytes);
                    }
                    where = "folder Download";
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir != null && !dir.exists()) dir.mkdirs();
                    try (FileOutputStream os = new FileOutputStream(new File(dir, filename))) {
                        os.write(bytes);
                    }
                    where = "folder aplikasi";
                }

                // Salinan untuk dibagikan (WhatsApp, Drive, email).
                File share = new File(new File(getCacheDir(), "ekspor"), filename);
                share.getParentFile().mkdirs();
                try (FileOutputStream os = new FileOutputStream(share)) {
                    os.write(bytes);
                }
                final Uri shareUri = FileProvider.getUriForFile(MainActivity.this,
                        getPackageName() + ".fileprovider", share);
                runOnUiThread(() -> {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(mime);
                    send.putExtra(Intent.EXTRA_STREAM, shareUri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "Bagikan rekap nilai"));
                });
                return "Tersimpan di " + where + ": " + filename;
            } catch (Exception e) {
                return "ERROR: " + e.getMessage();
            }
        }
    }
}
