package com.conova.music;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;

final class NativeNetwork {
    static final long AUDIO_CHUNK_SIZE = 2 * 1024 * 1024;
    static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36";

    static boolean allowed(String value, String kind) {
        try {
            URI uri = new URI(value);
            if (uri.getUserInfo() != null || uri.getHost() == null) return false;
            if ("audio".equals(kind)) return "https".equals(uri.getScheme()) || "http".equals(uri.getScheme());
            if (!"https".equals(uri.getScheme())) return false;
            int port = uri.getPort();
            if (port != -1 && port != 443) return false;
            String host = uri.getHost();
            if (host == null) return false;
            host = host.toLowerCase(java.util.Locale.ROOT);
            if ("api".equals(kind)) return host.equals("api.bilibili.com") || host.equals("passport.bilibili.com");
            String[] hosts = new String[]{"hdslb.com", "biliimg.com"};
            for (String suffix : hosts) if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        } catch (Exception ignored) {}
        return false;
    }

    static HttpURLConnection open(String address, String kind, String cookie, String range, boolean head) throws IOException {
        for (int redirect = 0; redirect <= 3; redirect++) {
            if (!allowed(address, kind)) throw new IOException("不支持的 B 站地址。");
            HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(18000);
            connection.setReadTimeout("audio".equals(kind) ? 45000 : 18000);
            connection.setRequestMethod(head ? "HEAD" : "GET");
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Referer", "https://www.bilibili.com/");
            connection.setRequestProperty("Accept-Encoding", "identity");
            if ("api".equals(kind) && cookie != null && !cookie.isEmpty() && !cookie.contains("\r") && !cookie.contains("\n")) connection.setRequestProperty("Cookie", cookie);
            if (range != null && range.matches("bytes=(?:[0-9]{1,20}-[0-9]{0,20}|-[0-9]{1,20})")) connection.setRequestProperty("Range", range);
            int status = connection.getResponseCode();
            if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) return connection;
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null) throw new IOException("B 站返回了无效的重定向。");
            address = new URL(new URL(address), location).toString();
        }
        throw new IOException("B 站重定向次数过多。");
    }

    static String audioRange(String value) {
        if (value == null || !value.matches("bytes=(?:[0-9]{1,20}-[0-9]{0,20}|-[0-9]{1,20})")) return null;
        if (value.startsWith("bytes=-")) return value;
        try {
            String[] parts = value.substring(6).split("-", -1);
            java.math.BigInteger start = new java.math.BigInteger(parts[0]);
            java.math.BigInteger limit = start.add(java.math.BigInteger.valueOf(AUDIO_CHUNK_SIZE - 1));
            java.math.BigInteger end = parts[1].isEmpty() ? limit : new java.math.BigInteger(parts[1]);
            return "bytes=" + start + "-" + end.min(limit);
        } catch (NumberFormatException ignored) { return null; }
    }

    static String read(InputStream input) throws IOException {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                if (output.size() + count > 4 * 1024 * 1024) throw new IOException("B 站返回的数据过大。");
                output.write(buffer, 0, count);
            }
            return output.toString("UTF-8");
        }
    }
}
