package com.conova.music;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// WebView's AndroidStreamReaderURLLoader checks available() as the file size
// and calls skip(rangeStart) even for an intercepted 206 response. The CDN has
// already applied that offset: credit the skip instead of discarding it twice.
final class MediaInputStream extends FilterInputStream {
    private final long start, total;
    private final Runnable disconnect;
    private long position;

    MediaInputStream(InputStream input, long start, long total, Runnable disconnect) {
        super(input);
        this.start = start;
        this.total = total;
        this.disconnect = disconnect;
    }

    static MediaInputStream open(HttpURLConnection connection) throws IOException {
        long start = 0, total = connection.getContentLengthLong();
        String contentRange = connection.getHeaderField("Content-Range");
        if (contentRange != null) {
            Matcher range = Pattern.compile("bytes ([0-9]+)-[0-9]+/([0-9]+|\\*)").matcher(contentRange);
            if (range.matches()) {
                try { start = Long.parseLong(range.group(1)); total = "*".equals(range.group(2)) ? -1 : Long.parseLong(range.group(2)); }
                catch (NumberFormatException ignored) { total = -1; }
            }
        }
        return new MediaInputStream(connection.getInputStream(), start, total, connection::disconnect);
    }

    @Override public int available() {
        // Zero means an unknown size to WebView, including files beyond its
        // 32-bit available() limit. Never use the current network buffer size.
        return total < 0 || total > Integer.MAX_VALUE ? 0 : (int) Math.max(0, total - position);
    }

    @Override public long skip(long count) throws IOException {
        if (count <= 0) return 0;
        long credit = Math.min(count, Math.max(0, start - position));
        position += credit;
        if (credit > 0) return credit;
        long skipped = in.skip(count);
        position += skipped;
        return skipped;
    }

    @Override public int read() throws IOException {
        int value = in.read();
        if (value >= 0) position = Math.max(position, start) + 1;
        return value;
    }

    @Override public int read(byte[] buffer, int offset, int length) throws IOException {
        int count = in.read(buffer, offset, length);
        if (count > 0) position = Math.max(position, start) + count;
        return count;
    }

    @Override public void close() throws IOException { try { super.close(); } finally { disconnect.run(); } }
}
