package com.conova.music;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

// A virtual two-hour recording: no large fixture or external CDN is required.
final class LongAudioServer implements AutoCloseable {
    static final int TOTAL = 44 + 7200 * 8000 * 2;
    final List<Long> offsets = new CopyOnWriteArrayList<>();
    final AtomicLong largestRange = new AtomicLong();
    private final ServerSocket server = new ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"));
    private final ExecutorService workers = Executors.newFixedThreadPool(4);
    private final byte[] header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        .put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(TOTAL - 8)
        .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16)
        .putShort((short) 1).putShort((short) 1).putInt(8000).putInt(16000)
        .putShort((short) 2).putShort((short) 16)
        .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(TOTAL - 44).array();

    LongAudioServer() throws Exception {
        Thread listener = new Thread(() -> {
            while (!server.isClosed()) {
                try { Socket socket = server.accept(); workers.execute(() -> respond(socket)); }
                catch (Exception ignored) { break; }
            }
        }, "long-audio-test");
        listener.setDaemon(true);
        listener.start();
    }

    String url() { return "http://127.0.0.1:" + server.getLocalPort() + "/long.wav"; }

    private void respond(Socket socket) {
        try (Socket connection = socket) {
            connection.setSoTimeout(10000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.US_ASCII));
            String request = reader.readLine(), line, range = null;
            while ((line = reader.readLine()) != null && !line.isEmpty()) if (line.toLowerCase(java.util.Locale.ROOT).startsWith("range:")) range = line.substring(6).trim();
            long start = 0, end = TOTAL - 1;
            if (range != null) {
                String[] parts = range.substring(6).split("-", -1);
                start = Long.parseLong(parts[0]);
                if (!parts[1].isEmpty()) end = Math.min(end, Long.parseLong(parts[1]));
                largestRange.accumulateAndGet(end - start + 1, Math::max);
            }
            offsets.add(start);
            android.util.Log.i("ConovaLongAudio", "Range " + range + " -> " + start + "-" + end);
            OutputStream output = connection.getOutputStream();
            String headers = "HTTP/1.1 " + (range == null ? "200 OK" : "206 Partial Content") + "\r\nContent-Type: audio/wav\r\nAccept-Ranges: bytes\r\nContent-Length: " + (end - start + 1)
                + (range == null ? "" : "\r\nContent-Range: bytes " + start + "-" + end + "/" + TOTAL) + "\r\nConnection: close\r\n\r\n";
            output.write(headers.getBytes(StandardCharsets.US_ASCII));
            if (request.startsWith("HEAD ")) { output.flush(); return; }
            byte[] buffer = new byte[16384];
            for (long offset = start; offset <= end;) {
                int count = (int) Math.min(buffer.length, end - offset + 1);
                java.util.Arrays.fill(buffer, (byte) 0);
                if (offset < header.length) System.arraycopy(header, (int) offset, buffer, 0, Math.min(count, header.length - (int) offset));
                output.write(buffer, 0, count);
                offset += count;
            }
            output.flush();
        } catch (Exception ignored) {
            // Seeking is expected to close the old response early.
        }
    }

    @Override public void close() throws Exception { server.close(); workers.shutdownNow(); }
}
