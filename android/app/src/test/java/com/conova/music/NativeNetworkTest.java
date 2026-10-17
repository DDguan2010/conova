package com.conova.music;

import static org.junit.Assert.*;
import org.junit.Test;

public class NativeNetworkTest {
    @Test public void allowsOnlyHttpsBilibiliServices() {
        assertTrue(NativeNetwork.allowed("https://api.bilibili.com/x/web-interface/nav", "api"));
        assertTrue(NativeNetwork.allowed("https://passport.bilibili.com/x/passport-login/web/qrcode/generate", "api"));
        assertTrue(NativeNetwork.allowed("https://xy.mcdn.bilivideo.cn/music.m4s", "audio"));
        assertTrue(NativeNetwork.allowed("https://i0.hdslb.com/cover.jpg", "image"));
        for (String url : new String[]{"https://127.0.0.1/a", "http://a.bilivideo.com/a", "https://a.bilivideo.com.evil.com/a", "https://user:pass@a.bilivideo.com/a", "https://a.bilivideo.com:8443/a", "https://api.bilibili.com.evil.com/a"}) {
            assertFalse(url, NativeNetwork.allowed(url, "audio"));
            assertFalse(url, NativeNetwork.allowed(url, "api"));
        }
        assertFalse(NativeNetwork.allowed("https://api.bilibili.com/a", "image"));
        assertFalse(NativeNetwork.allowed("https://evil.com/cover.jpg", "image"));
    }
}
