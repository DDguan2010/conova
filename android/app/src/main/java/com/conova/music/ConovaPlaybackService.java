package com.conova.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/** Keeps the Android media session alive while the WebView is backgrounded. */
public final class ConovaPlaybackService extends Service {
    static final String ACTION_UPDATE = "com.conova.music.UPDATE_MEDIA";
    static final String ACTION_PLAY = "com.conova.music.PLAY";
    static final String ACTION_PAUSE = "com.conova.music.PAUSE";
    static final String ACTION_NEXT = "com.conova.music.NEXT";
    static final String ACTION_PREVIOUS = "com.conova.music.PREVIOUS";
    static final String ACTION_STOP = "com.conova.music.STOP";
    private static final String CHANNEL = "conova-playback";
    private static final int NOTIFICATION_ID = 42;

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private String title = "Conova";
    private String artist = "";
    private long duration;
    private long position;
    private boolean playing;

    static void update(Context context, String title, String artist, long duration, long position, boolean playing) {
        Intent intent = new Intent(context, ConovaPlaybackService.class)
                .setAction(ACTION_UPDATE)
                .putExtra("title", title)
                .putExtra("artist", artist)
                .putExtra("duration", duration)
                .putExtra("position", position)
                .putExtra("playing", playing);
        start(context, intent);
    }

    static void stop(Context context) {
        try { context.stopService(new Intent(context, ConovaPlaybackService.class)); }
        catch (RuntimeException ignored) { }
    }

    private static void start(Context context, Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException ignored) {
            // A revoked notification permission should not break the player.
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        session = new MediaSession(this, "Conova");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { playing = true; updateAudioFocus(); ConovaNativePlugin.dispatchMediaAction("play"); refresh(); }
            @Override public void onPause() { playing = false; abandonAudioFocus(); ConovaNativePlugin.dispatchMediaAction("pause"); refresh(); }
            @Override public void onSkipToNext() { ConovaNativePlugin.dispatchMediaAction("nexttrack"); }
            @Override public void onSkipToPrevious() { ConovaNativePlugin.dispatchMediaAction("previoustrack"); }
            @Override public void onStop() { playing = false; abandonAudioFocus(); ConovaNativePlugin.dispatchMediaAction("stop"); stopSelf(); }
            @Override public void onSeekTo(long value) { position = Math.max(0, value); ConovaNativePlugin.dispatchMediaSeek(position); refresh(); }
        });
        session.setActive(true);
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "conova:playback");
        wakeLock.setReferenceCounted(false);
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setOnAudioFocusChangeListener(change -> {
                        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                            playing = false;
                            ConovaNativePlugin.dispatchMediaAction("pause");
                            refresh();
                        }
                    }).build();
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_UPDATE.equals(action)) {
                title = value(intent.getStringExtra("title"), "Conova");
                artist = value(intent.getStringExtra("artist"), "");
                duration = Math.max(0, intent.getLongExtra("duration", 0));
                position = Math.max(0, intent.getLongExtra("position", 0));
                playing = intent.getBooleanExtra("playing", false);
            } else if (ACTION_PLAY.equals(action)) {
                playing = true;
                ConovaNativePlugin.dispatchMediaAction("play");
            } else if (ACTION_PAUSE.equals(action)) {
                playing = false;
                ConovaNativePlugin.dispatchMediaAction("pause");
            } else if (ACTION_NEXT.equals(action)) {
                ConovaNativePlugin.dispatchMediaAction("nexttrack");
            } else if (ACTION_PREVIOUS.equals(action)) {
                ConovaNativePlugin.dispatchMediaAction("previoustrack");
            } else if (ACTION_STOP.equals(action)) {
                ConovaNativePlugin.dispatchMediaAction("stop");
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        if (playing) updateAudioFocus(); else abandonAudioFocus();
        refresh();
        return START_STICKY;
    }

    private void refresh() {
        if (session == null) return;
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, 1f).build());
        session.setMetadata(new android.media.MediaMetadata.Builder().putString(android.media.MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(android.media.MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(android.media.MediaMetadata.METADATA_KEY_ALBUM, "Conova")
                .putLong(android.media.MediaMetadata.METADATA_KEY_DURATION, duration).build());
        if (playing && !wakeLock.isHeld()) wakeLock.acquire();
        if (!playing && wakeLock.isHeld()) wakeLock.release();
        Notification notification = notification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIFICATION_ID, notification);
        } catch (RuntimeException error) {
            // If notifications are blocked by the user, keep the WebView player alive
            // without allowing a foreground-service permission failure to crash the app.
            stopSelf();
        }
    }

    private Notification notification() {
        PendingIntent content = PendingIntent.getActivity(this, 1, new Intent(this, MainActivity.class), pendingFlags());
        Notification.Action previous = new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一首", command(ACTION_PREVIOUS)).build();
        Notification.Action play = new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "暂停" : "播放", command(playing ? ACTION_PAUSE : ACTION_PLAY)).build();
        Notification.Action next = new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一首", command(ACTION_NEXT)).build();
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        builder.setSmallIcon(com.conova.music.R.mipmap.ic_launcher).setContentTitle(title).setContentText(artist).setContentIntent(content)
                .setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(playing)
                .addAction(previous).addAction(play).addAction(next);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) builder.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        return builder.build();
    }

    private PendingIntent command(String action) { return PendingIntent.getService(this, action.hashCode(), new Intent(this, ConovaPlaybackService.class).setAction(action), pendingFlags()); }
    private int pendingFlags() { return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0); }
    private String value(String value, String fallback) { return value == null || value.isEmpty() ? fallback : value; }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Conova 播放", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("音乐播放控制"); channel.setShowBadge(false); channel.setLightColor(Color.WHITE);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }

    private void updateAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) audioManager.requestAudioFocus(audioFocusRequest);
        else audioManager.requestAudioFocus(change -> { }, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
    }
    private void abandonAudioFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) audioManager.abandonAudioFocusRequest(audioFocusRequest);
        else audioManager.abandonAudioFocus(null);
    }

    @Override public void onDestroy() {
        abandonAudioFocus();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (session != null) { session.setActive(false); session.release(); }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
