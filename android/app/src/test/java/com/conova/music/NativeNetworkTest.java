package com.conova.music;

import static org.junit.Assert.*;
import org.junit.Test;

public class NativeNetworkTest {
    @Test public void keepsApiAndCoversRestrictedButAcceptsAnyHttpMediaFromPlayurl() {
        assertTrue(NativeNetwork.allowed("https://api.bilibili.com/x/web-interface/nav", "api"));
        assertTrue(NativeNetwork.allowed("https://passport.bilibili.com/x/passport-login/web/qrcode/generate", "api"));
        assertTrue(NativeNetwork.allowed("https://xy.mcdn.bilivideo.cn/music.m4s", "audio"));
        assertTrue(NativeNetwork.allowed("https://xy.mcdn.bilivideo.cn:8082/music.m4s", "audio"));
        assertTrue(NativeNetwork.allowed("https://edge.mountaintoys.cn:4483/music.m4s", "audio"));
        assertTrue(NativeNetwork.allowed("http://partner.example:8080/music.m4s", "audio"));
        assertTrue(NativeNetwork.allowed("https://i0.hdslb.com/cover.jpg", "image"));
        for (String url : new String[]{"https://127.0.0.1/a", "http://a.bilivideo.com/a", "https://a.bilivideo.com.evil.com/a", "https://user:pass@a.bilivideo.com/a", "https://a.bilivideo.com:8443/a", "https://api.bilibili.com.evil.com/a"}) {
            assertFalse(url, NativeNetwork.allowed(url, "api"));
        }
        for (String url : new String[]{"file:///tmp/a", "data:audio/mp4;base64,AA==", "ftp://partner.example/a", "https://user:pass@cdn.example/a", "not a URL"}) assertFalse(url, NativeNetwork.allowed(url, "audio"));
        assertFalse(NativeNetwork.allowed("https://api.bilibili.com:8082/a", "api"));
        assertFalse(NativeNetwork.allowed("https://api.bilibili.com/a", "image"));
        assertFalse(NativeNetwork.allowed("https://evil.com/cover.jpg", "image"));
    }

    @Test public void boundsLargeRangesWithoutChangingSmallOrSuffixRequests() {
        assertEquals("bytes=0-2097151", NativeNetwork.audioRange("bytes=0-"));
        assertEquals("bytes=100000000-102097151", NativeNetwork.audioRange("bytes=100000000-999999999"));
        assertEquals("bytes=100-199", NativeNetwork.audioRange("bytes=100-199"));
        assertEquals("bytes=-1024", NativeNetwork.audioRange("bytes=-1024"));
        assertNull(NativeNetwork.audioRange("bytes=0-1,3-4"));
    }
}
