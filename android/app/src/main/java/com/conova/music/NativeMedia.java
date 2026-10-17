package com.conova.music;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

final class NativeMedia {
    interface Opener {
        HttpURLConnection open(String url, String kind, String cookie, String range, boolean head) throws IOException;
    }
    private static final Map<String, Ticket> tickets = new ConcurrentHashMap<>();
    private static final class Ticket {
        final String url, cookie;
        final long expires = System.currentTimeMillis() + 2 * 3600000L;
        Ticket(String url, String cookie) { this.url = url; this.cookie = cookie; }
    }

    static String register(String url, String cookie) throws IOException {
        if (!NativeNetwork.allowed(url, "audio")) throw new IOException("音频地址不属于 B 站媒体服务。");
        for (Map.Entry<String, Ticket> entry : tickets.entrySet()) if (entry.getValue().expires < System.currentTimeMillis()) tickets.remove(entry.getKey());
        if (tickets.size() >= 128) {
            String oldest = null;
            long earliest = Long.MAX_VALUE;
            for (Map.Entry<String, Ticket> entry : tickets.entrySet()) if (entry.getValue().expires < earliest) { oldest = entry.getKey(); earliest = entry.getValue().expires; }
            if (oldest != null) tickets.remove(oldest);
        }
        String id = UUID.randomUUID().toString();
        tickets.put(id, new Ticket(url, cookie));
        return "/__conova/audio/" + id;
    }

    static void clear() { tickets.clear(); }

    static WebResourceResponse intercept(WebResourceRequest request) {
        return intercept(request, NativeNetwork::open);
    }

    static WebResourceResponse intercept(WebResourceRequest request, Opener opener) {
        Uri uri = request.getUrl();
        if (!"https".equals(uri.getScheme()) || !"localhost".equals(uri.getHost()) || !uri.getPath().startsWith("/__conova/")) return null;
        if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) return error(405, "Method Not Allowed");
        try {
            String url, cookie = "", kind;
            if (uri.getPath().startsWith("/__conova/audio/")) {
                Ticket ticket = tickets.get(uri.getLastPathSegment());
                if (ticket == null || ticket.expires < System.currentTimeMillis()) return error(410, "Gone");
                url = ticket.url; cookie = ticket.cookie; kind = "audio";
            } else if (uri.getPath().equals("/__conova/image")) {
                url = uri.getQueryParameter("url"); kind = "image";
            } else return error(404, "Not Found");
            String range = null;
            for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) if (entry.getKey().equalsIgnoreCase("Range")) range = entry.getValue();
            boolean head = "HEAD".equals(request.getMethod());
            if (!NativeNetwork.allowed(url, kind)) return error(400, "Bad Request");
            final HttpURLConnection connection = opener.open(url, kind, cookie, range, head);
            int status = connection.getResponseCode();
            if (status != 200 && status != 206 && status != 416) { connection.disconnect(); return error(502, "Bad Gateway"); }
            String type = connection.getContentType();
            if (type == null) type = "audio".equals(kind) ? "audio/mp4" : "application/octet-stream";
            if (kind.equals("image") && !type.startsWith("image/")) { connection.disconnect(); return error(502, "Bad Gateway"); }
            Map<String, String> headers = new HashMap<>();
            for (String header : new String[]{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"}) {
                String value = connection.getHeaderField(header);
                if (value != null) headers.put(header, value);
            }
            headers.put("Cache-Control", kind.equals("image") ? "private, max-age=86400" : "no-store");
            headers.put("Access-Control-Allow-Origin", "https://localhost");
            headers.put("X-Content-Type-Options", "nosniff");
            InputStream body;
            if (head || status == 416) { connection.disconnect(); body = new ByteArrayInputStream(new byte[0]); }
            else body = new FilterInputStream(connection.getInputStream()) {
                @Override public void close() throws IOException { try { super.close(); } finally { connection.disconnect(); } }
            };
            return new WebResourceResponse(type.split(";")[0], null, status, status == 206 ? "Partial Content" : status == 416 ? "Range Not Satisfiable" : "OK", headers, body);
        } catch (Exception error) { return error(502, "Bad Gateway"); }
    }

    private static WebResourceResponse error(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, java.util.Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(reason.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
}
