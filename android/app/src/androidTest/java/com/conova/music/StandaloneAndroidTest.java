package com.conova.music;

import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom;
import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class StandaloneAndroidTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @After public void cleanUp() throws Exception {
        NativeMedia.clear();
        new NativeStateStore(context).write("{\"library\":[]}");
    }

    @Test public void privateSessionIsEncryptedAndSurvivesRestart() throws Exception {
        String state = "{\"biliCookie\":\"SESSDATA=instrumentation-only\",\"library\":[{\"id\":\"favorite:1\"}]}";
        new NativeStateStore(context).write(state);
        assertEquals(state, new NativeStateStore(context).read());
        java.io.File file = new java.io.File(context.getNoBackupFilesDir(), "conova-state.enc");
        byte[] data = new byte[(int) file.length()];
        try (java.io.FileInputStream input = new java.io.FileInputStream(file)) { assertEquals(data.length, input.read(data)); }
        assertFalse(new String(data, StandardCharsets.UTF_8).contains("SESSDATA"));
    }

    @Test public void audioRequestsRetainRangesAndAreRevokedOnLogout() throws Exception {
        String path = NativeMedia.register("https://cdn.bilivideo.com/music.m4s", "SESSDATA=test-only");
        final boolean[] closed = { false };
        NativeMedia.Opener upstream = (url, kind, cookie, range, head) -> {
            assertEquals("audio", kind); assertEquals("SESSDATA=test-only", cookie); assertEquals("bytes=2-4", range);
            return new HttpURLConnection(new URL(url)) {
                @Override public void connect() {}
                @Override public boolean usingProxy() { return false; }
                @Override public void disconnect() { closed[0] = true; }
                @Override public int getResponseCode() { return 206; }
                @Override public String getContentType() { return "audio/mp4"; }
                @Override public String getHeaderField(String name) {
                    if (name.equals("Content-Range")) return "bytes 2-4/6";
                    if (name.equals("Content-Length")) return "3";
                    if (name.equals("Accept-Ranges")) return "bytes";
                    return null;
                }
                @Override public InputStream getInputStream() { return new ByteArrayInputStream("cde".getBytes(StandardCharsets.UTF_8)); }
            };
        };
        WebResourceRequest request = request(path, Collections.singletonMap("Range", "bytes=2-4"));
        WebResourceResponse response = NativeMedia.intercept(request, upstream);
        assertEquals(206, response.getStatusCode());
        assertEquals("bytes 2-4/6", response.getResponseHeaders().get("Content-Range"));
        assertEquals("https://localhost", response.getResponseHeaders().get("Access-Control-Allow-Origin"));
        assertEquals("cde", NativeNetwork.read(response.getData()));
        assertTrue(closed[0]);
        NativeMedia.clear();
        assertEquals(410, NativeMedia.intercept(request, upstream).getStatusCode());
    }

    @Test public void invalidCoversNeverReachTheNetwork() {
        WebResourceRequest request = request("/__conova/image?url=https%3A%2F%2F127.0.0.1%2Fprivate", Collections.emptyMap());
        assertEquals(400, NativeMedia.intercept(request, (url, kind, cookie, range, head) -> { fail("Must not fetch private hosts"); return null; }).getStatusCode());
    }

    @Test public void installedAppStartsWithLoginChoicesAndNoServerConfiguration() throws Exception {
        new NativeStateStore(context).write("{\"library\":[]}");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario, "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='账号登录') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='扫码登录')");
            assertEquals("\"android\"", evaluate(scenario, "window.Capacitor.getPlatform()"));
            assertEquals("false", evaluate(scenario, "document.body.innerText.includes('服务地址') || !!document.querySelector('input[type=url]')"));
            evaluate(scenario, "window.__nativeState=null;window.Capacitor.Plugins.ConovaNative.readState().then(r=>window.__nativeState=r.value);true");
            waitFor(scenario, "typeof window.__nativeState==='string'");
            assertEquals("true", evaluate(scenario, "JSON.parse(window.__nativeState).library.length===0"));
        }
    }

    @Test public void bilibiliQrEndpointWorksThroughAndroidNativeHttps() throws Exception {
        HttpURLConnection connection = NativeNetwork.open("https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header", "api", "", null, false);
        try {
            assertEquals(200, connection.getResponseCode());
            org.json.JSONObject response = new org.json.JSONObject(NativeNetwork.read(connection.getInputStream()));
            assertEquals(0, response.getInt("code"));
            assertTrue(response.getJSONObject("data").getString("url").startsWith("https://"));
            assertFalse(response.getJSONObject("data").getString("qrcode_key").isEmpty());
        } finally { connection.disconnect(); }
    }

    @Test public void packagedAudioPlaysAndSeeksInAndroidWebView() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.getBridge().getWebView().loadUrl("https://localhost/?demo=1"));
            waitFor(scenario, "!!document.querySelector('[data-testid=current-cover]')");
            onView(isAssignableFrom(android.webkit.WebView.class)).perform(click());
            waitFor(scenario, "document.querySelector('main').classList.contains('playing') && Number(document.querySelector('[aria-label=播放进度]').value)>0");
            evaluate(scenario, "(()=>{const i=document.querySelector('[aria-label=播放进度]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'12');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
            waitFor(scenario, "Number(document.querySelector('[aria-label=播放进度]').value)>=12");
            onView(isAssignableFrom(android.webkit.WebView.class)).perform(click());
            waitFor(scenario, "document.querySelector('main').classList.contains('paused')");
            assertEquals("false", evaluate(scenario, "document.body.innerText.includes('服务地址')"));
        }
    }

    private WebResourceRequest request(String path, Map<String, String> headers) {
        return new WebResourceRequest() {
            @Override public Uri getUrl() { return Uri.parse("https://localhost" + path); }
            @Override public boolean isForMainFrame() { return false; }
            @Override public boolean isRedirect() { return false; }
            @Override public boolean hasGesture() { return false; }
            @Override public String getMethod() { return "GET"; }
            @Override public Map<String, String> getRequestHeaders() { return headers; }
        };
    }

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); latch.countDown(); }));
        assertTrue("JavaScript callback timed out", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void waitFor(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 25000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate(scenario, "(()=>{try{return Boolean(" + expression + ")}catch(e){return false}})()"))) return;
            Thread.sleep(200);
        }
        fail("Android WebView condition not met: " + expression + "; body=" + evaluate(scenario, "document.body.innerText"));
    }
}
