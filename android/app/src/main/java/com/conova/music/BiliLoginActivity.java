package com.conova.music;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import java.net.URI;

// The official login page has its own WebView and no Capacitor/JS interfaces.
public class BiliLoginActivity extends AppCompatActivity {
    private WebView webView;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = new Runnable() {
        @Override public void run() { if (!finishIfLoggedIn()) handler.postDelayed(this, 1500); }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.BLACK);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        CookieManager.getInstance().setAcceptCookie(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return request.isForMainFrame() && !official(request.getUrl().toString()); }
            @Override public void onPageFinished(WebView view, String url) { finishIfLoggedIn(); }
        });
        setContentView(webView);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { setResult(Activity.RESULT_CANCELED); finish(); }
        });
        webView.loadUrl("https://passport.bilibili.com/h5-app/passport/login");
    }

    private static boolean official(String value) {
        try { URI uri = new URI(value); String host = uri.getHost(); return "https".equals(uri.getScheme()) && host != null && (host.equals("bilibili.com") || host.endsWith(".bilibili.com")); }
        catch (Exception ignored) { return false; }
    }

    private boolean finishIfLoggedIn() {
        if (isFinishing()) return true;
        String cookies = CookieManager.getInstance().getCookie("https://www.bilibili.com/");
        if (cookies == null || !java.util.regex.Pattern.compile("(?:^|;\\s*)SESSDATA=[^;]+").matcher(cookies).find()) return false;
        CookieManager.getInstance().flush();
        setResult(Activity.RESULT_OK, new Intent().putExtra("cookies", cookies));
        finish();
        return true;
    }

    @Override protected void onResume() { super.onResume(); handler.post(poll); }
    @Override protected void onPause() { handler.removeCallbacks(poll); super.onPause(); }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); if (webView != null) { webView.stopLoading(); webView.destroy(); } super.onDestroy(); }
}
