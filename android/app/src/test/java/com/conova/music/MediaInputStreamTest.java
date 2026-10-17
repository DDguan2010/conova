package com.conova.music;

import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class MediaInputStreamTest {
    @Test public void webViewRangeSkipDoesNotConsumeAlreadyRangedData() throws Exception {
        try (MediaInputStream stream = new MediaInputStream(new ByteArrayInputStream("xyz".getBytes(StandardCharsets.UTF_8)), 60000000, 115200044, () -> {})) {
            assertEquals(115200044, stream.available());
            assertEquals(60000000, stream.skip(60000000));
            assertEquals("xyz", new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    @Test public void partialVirtualSkipsAndRealSkipsPreserveTheRequestedBytes() throws Exception {
        try (MediaInputStream stream = new MediaInputStream(new ByteArrayInputStream("cdef".getBytes(StandardCharsets.UTF_8)), 2, 6, () -> {})) {
            assertEquals(1, stream.skip(1));
            assertEquals(1, stream.skip(1));
            assertEquals(1, stream.skip(1));
            assertEquals('d', stream.read());
            assertEquals(2, stream.available());
        }
    }

    @Test public void largeOffsetsDoNotOverflowOrReadDataToSkip() throws Exception {
        try (MediaInputStream stream = new MediaInputStream(new ByteArrayInputStream(new byte[]{42}), 6000000000L, 7000000000L, () -> {})) {
            assertEquals(0, stream.available());
            assertEquals(6000000000L, stream.skip(6000000000L));
            assertEquals(42, stream.read());
        }
    }

    @Test public void fullResponsesStillSkipActualBytesAndReleaseTheirConnection() throws Exception {
        final boolean[] closed = {false};
        try (MediaInputStream stream = new MediaInputStream(new ByteArrayInputStream(new byte[]{1, 2, 3}), 0, 3, () -> closed[0] = true)) {
            assertEquals(2, stream.skip(2));
            assertEquals(3, stream.read());
        }
        assertTrue(closed[0]);
    }
}
