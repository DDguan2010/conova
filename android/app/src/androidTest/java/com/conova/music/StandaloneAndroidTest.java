package com.conova.music;

import static org.junit.Assert.*;
import android.content.Context;
import android.net.Uri;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
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

    @Test public void audioFallsBackToPartnerCdnAndKeepsLongSeekRangesSmall() throws Exception {
        String primary = "https://xy.mcdn.bilivideo.cn:8082/music.m4s";
        String backup = "http://edge.mountaintoys.cn:4483/music.m4s";
        for (int failure : new int[]{0, 403, 200}) {
            String path = NativeMedia.register(primary, "", Arrays.asList(backup, "file:///invalid"));
            List<String> attempts = new ArrayList<>();
            final boolean[] discarded = {false};
            NativeMedia.Opener upstream = (url, kind, cookie, range, head) -> {
                attempts.add(url);
                assertEquals("", cookie);
                assertEquals("bytes=60000000-62097151", range);
                if (url.equals(primary) && failure == 0) throw new IOException("node unavailable");
                int status = url.equals(primary) ? failure : 206;
                boolean firstNode = url.equals(primary);
                return new HttpURLConnection(new URL(url)) {
                    @Override public void connect() {}
                    @Override public boolean usingProxy() { return false; }
                    @Override public void disconnect() { if (firstNode) discarded[0] = true; }
                    @Override public int getResponseCode() { return status; }
                    @Override public String getContentType() { return "audio/mp4"; }
                    @Override public String getHeaderField(String name) {
                        if (name.equals("Content-Range")) return "bytes 60000000-60000002/115200044";
                        if (name.equals("Content-Length")) return "3";
                        if (name.equals("Accept-Ranges")) return "bytes";
                        return null;
                    }
                    @Override public InputStream getInputStream() { return new ByteArrayInputStream("xyz".getBytes(StandardCharsets.UTF_8)); }
                };
            };
            WebResourceRequest request = request(path, Collections.singletonMap("Range", "bytes=60000000-"));
            for (int index = 0; index < 2; index++) {
                WebResourceResponse response = NativeMedia.intercept(request, upstream);
                assertEquals(206, response.getStatusCode());
                assertEquals("bytes 60000000-60000002/115200044", response.getResponseHeaders().get("Content-Range"));
                assertEquals("xyz", NativeNetwork.read(response.getData()));
            }
            assertEquals(Arrays.asList(primary, backup, backup), attempts);
            if (failure != 0) assertTrue(discarded[0]);
        }
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
            evaluate(scenario, "window.__touches=[];['pointerdown','pointerup','click','contextmenu'].forEach(type=>document.addEventListener(type,e=>window.__touches.push({type,time:e.timeStamp,trusted:e.isTrusted}),true));true");
            tapCover(scenario);
            waitFor(scenario, "document.querySelector('main').classList.contains('playing') && Number(document.querySelector('[aria-label=播放进度]').value)>0");
            evaluate(scenario, "(()=>{const i=document.querySelector('[aria-label=播放进度]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'12');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
            waitFor(scenario, "Number(document.querySelector('[aria-label=播放进度]').value)>=12");
            tapCover(scenario);
            waitFor(scenario, "document.querySelector('main').classList.contains('paused')");
            assertEquals("false", evaluate(scenario, "document.body.innerText.includes('服务地址')"));
        }
    }

    @Test public void twoHourAudioSeeksThroughNativeHttpRangeProxy() throws Exception {
        try (LongAudioServer audio = new LongAudioServer(); ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            String path = NativeMedia.register(audio.url(), "");
            scenario.onActivity(activity -> activity.getBridge().getWebView().loadUrl("https://localhost/?demo=1"));
            waitFor(scenario, "!!document.querySelector('[data-testid=current-cover]')");
            evaluate(scenario, "(()=>{const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');Object.defineProperty(HTMLMediaElement.prototype,'src',{...d,set(v){window.__longAudio=this;d.set.call(this,v.includes('/audio/ambient.wav')?" + org.json.JSONObject.quote("https://localhost" + path) + ":v)}});return true})()");
            tapCover(scenario);
            waitFor(scenario, "window.__longAudio?.duration===7200 && document.querySelector('main').classList.contains('playing')");
            evaluate(scenario, "(()=>{const i=document.querySelector('[aria-label=播放进度]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'5400');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
            waitFor(scenario, "!window.__longAudio.seeking && window.__longAudio.currentTime>=5400 && document.querySelector('main').classList.contains('playing')");
            assertTrue("Seek must request the distant byte offset", audio.offsets.stream().anyMatch(value -> value > 60000000));
            assertTrue("Each native read must stay bounded", audio.largestRange.get() <= NativeNetwork.AUDIO_CHUNK_SIZE);
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

    private void tapCover(ActivityScenario<MainActivity> scenario) throws Exception {
        AtomicReference<float[]> center = new AtomicReference<>();
        scenario.onActivity(activity -> {
            android.webkit.WebView view = activity.getBridge().getWebView();
            int[] origin = new int[2];
            view.getLocationOnScreen(origin);
            center.set(new float[]{origin[0] + view.getWidth() / 2f, origin[1] + view.getHeight() / 2f});
        });
        // Queue both trusted events together. Sleeping between injection calls
        // can turn a short tap into a long press when the emulator is busy.
        long start = SystemClock.uptimeMillis() - 60;
        float[] point = center.get();
        MotionEvent down = MotionEvent.obtain(start, start, MotionEvent.ACTION_DOWN, point[0], point[1], 0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        assertTrue(InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(down, false));
        MotionEvent up = MotionEvent.obtain(start, start + 60, MotionEvent.ACTION_UP, point[0], point[1], 0);
        up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        assertTrue(InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(up, false));
        down.recycle(); up.recycle();
    }

    private void waitFor(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 25000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate(scenario, "(()=>{try{return Boolean(" + expression + ")}catch(e){return false}})()"))) return;
            Thread.sleep(200);
        }
        fail("Android WebView condition not met: " + expression + "; body=" + evaluate(scenario, "document.body.innerText") + "; touches=" + evaluate(scenario, "JSON.stringify(window.__touches)") + "; media=" + evaluate(scenario, "JSON.stringify((()=>{const a=window.__longAudio,i=document.querySelector('[aria-label=播放进度]');return a?{time:a.currentTime,duration:a.duration,seeking:a.seeking,ready:a.readyState,paused:a.paused,error:a.error?.message,seekable:Array.from({length:a.seekable.length},(_,n)=>[a.seekable.start(n),a.seekable.end(n)]),buffered:Array.from({length:a.buffered.length},(_,n)=>[a.buffered.start(n),a.buffered.end(n)]),value:i?.value,max:i?.max,classes:document.querySelector('main')?.className}:null})())"));
    }
}
