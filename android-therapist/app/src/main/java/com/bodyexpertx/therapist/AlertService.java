package com.bodyexpertx.therapist;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class AlertService extends Service {
    public static final String ACTION_START = "com.bodyexpertx.therapist.START";
    public static final String ACTION_DUTY_OFF = "com.bodyexpertx.therapist.DUTY_OFF";
    public static final String ACTION_STOP_ALARM = "com.bodyexpertx.therapist.STOP_ALARM";
    public static final String ACTION_UPDATE_REFRESH = "com.bodyexpertx.therapist.UPDATE_REFRESH";
    private static final String CHANNEL = "bex_duty_alerts";
    private static final int NOTIFICATION_ID = 4401;
    private static final String API = "https://myjstwbpmbrhaiwytpnq.supabase.co/functions/v1/therapist-portal";
    private static final String API_KEY = "sb_publishable_jHjVYTPlBLDgaNfiazRkvg_iVI_5-Xy";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String token = "";
    private volatile String refreshToken = "";
    private final android.content.SharedPreferences prefs;
    private final Runnable wakeRenewal = new Runnable() { @Override public void run() { if (dutyOn) { try { if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(10 * 60 * 1000L); } catch (Exception e) { Log.w("BEXAlarm", "WakeLock renewal failed", e); } handler.postDelayed(this, 9 * 60 * 1000L); } } };
    private volatile boolean dutyOn = false;
    private volatile boolean pollInFlight = false;
    private MediaPlayer player;
    private PowerManager.WakeLock wakeLock;
    private boolean baselineReady = false;
    private final Set<String> known = new HashSet<>();
    private final Runnable poller = new Runnable() {
        @Override public void run() {
            if (!dutyOn || token.isEmpty()) return;
            if (!pollInFlight) {
                pollInFlight = true;
                worker.execute(() -> {
                    try { checkBookings(); }
                    catch (Exception e) { Log.w("BEXAlarm", "Booking check failed", e); }
                    finally {
                        pollInFlight = false;
                        handler.postDelayed(poller, 8000);
                    }
                });
            } else handler.postDelayed(this, 2000);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences("bex_alarm", MODE_PRIVATE);
        token = prefs.getString("access_token", "");
        refreshToken = prefs.getString("refresh_token", "");
        dutyOn = prefs.getBoolean("duty_on", false);
        createChannel();
        PowerManager pm = (PowerManager)getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BodyExpertX:BookingAlert");
        wakeLock.setReferenceCounted(false);
        startForeground(NOTIFICATION_ID, buildStatusNotification("Duty alert ready"));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_STOP_ALARM.equals(action)) { stopAlarm(); return START_STICKY; }
            if (ACTION_UPDATE_REFRESH.equals(action)) {
                String rt = intent.getStringExtra("refresh_token");
                if (rt != null && rt.length() > 20) { refreshToken = rt; prefs.edit().putString("refresh_token", rt).apply(); }
                return START_STICKY;
            }
            if (ACTION_DUTY_OFF.equals(action)) {
                dutyOn = false; token = intent.getStringExtra("token") == null ? token : intent.getStringExtra("token");
                prefs.edit().putBoolean("duty_on", false).putString("access_token", token).apply();
                handler.removeCallbacks(poller); handler.removeCallbacks(wakeRenewal); stopAlarm();
                if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
                updateStatus("Duty OFF — alarm monitoring paused");
                return START_STICKY;
            }
            String newToken = intent.getStringExtra("token");
            String newRefreshToken = intent.getStringExtra("refresh_token");
            if (newToken != null && newToken.length() > 20) token = newToken;
            if (newRefreshToken != null && newRefreshToken.length() > 20) refreshToken = newRefreshToken;
            if (newToken != null || newRefreshToken != null) prefs.edit().putString("access_token", token).putString("refresh_token", refreshToken).apply();
            if (ACTION_START.equals(action)) {
                dutyOn = true;
                prefs.edit().putBoolean("duty_on", true).apply();
                if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(10 * 60 * 1000L);
                handler.removeCallbacks(wakeRenewal); handler.postDelayed(wakeRenewal, 9 * 60 * 1000L);
                handler.removeCallbacks(poller);
                handler.post(poller);
                updateStatus("Duty ON — checking for new jobs");
            }
        }
        if (intent == null && dutyOn && !token.isEmpty()) {
            try { if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(10 * 60 * 1000L); } catch (Exception ignored) {}
            handler.removeCallbacks(wakeRenewal); handler.postDelayed(wakeRenewal, 9 * 60 * 1000L);
            handler.removeCallbacks(poller); handler.post(poller);
        }
        return START_STICKY;
    }

    private void checkBookings() throws Exception {
        JSONObject json = requestDashboard();
        if (json == null) return;
        JSONArray jobs = json.optJSONArray("jobs");
        if (jobs == null) return;
        Set<String> now = new HashSet<>();
        for (int i=0;i<jobs.length();i++) {
            JSONObject job = jobs.optJSONObject(i); if (job == null) continue;
            String st = job.optString("status", "");
            String id = job.optString("id", "");
            if (!id.isEmpty() && ("awaiting_whatsapp".equals(st) || "whatsapp_opened".equals(st))) now.add(id);
        }
        if (!baselineReady) {
            known.clear(); known.addAll(now); baselineReady = true; return;
        }
        boolean fresh = false;
        for (String id : now) if (!known.contains(id)) fresh = true;
        known.clear(); known.addAll(now);
        if (fresh && dutyOn) handler.post(() -> { startAlarm(); updateStatus("NEW JOB — alarm ringing until you stop it"); });
    }

    private JSONObject requestDashboard() throws Exception { return requestDashboard(true); }

    private JSONObject requestDashboard(boolean allowRefresh) throws Exception {
        HttpURLConnection c = (HttpURLConnection)new URL(API).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(10000); c.setReadTimeout(12000); c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("apikey", API_KEY);
        c.setRequestProperty("Authorization", "Bearer " + token);
        byte[] body = "{\"action\":\"dashboard\"}".getBytes(StandardCharsets.UTF_8);
        c.getOutputStream().write(body);
        int status = c.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? c.getInputStream() : c.getErrorStream();
        StringBuilder out = new StringBuilder();
        if (stream != null) try (BufferedReader br = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line; while ((line = br.readLine()) != null) out.append(line);
        }
        c.disconnect();
        if (allowRefresh && (status == 400 || status == 401 || status == 403) && !refreshToken.isEmpty() && refreshSession()) return requestDashboard(false);
        if (status < 200 || status >= 300) throw new Exception("Dashboard HTTP " + status + ": " + out);
        return new JSONObject(out.toString());
    }

    private boolean refreshSession() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection)new URL("https://myjstwbpmbrhaiwytpnq.supabase.co/auth/v1/token?grant_type=refresh_token").openConnection();
            c.setRequestMethod("POST"); c.setConnectTimeout(10000); c.setReadTimeout(12000); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("apikey", API_KEY);
            byte[] body = new JSONObject().put("refresh_token", refreshToken).toString().getBytes(StandardCharsets.UTF_8);
            c.getOutputStream().write(body);
            int status = c.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? c.getInputStream() : c.getErrorStream();
            if (stream == null || status < 200 || status >= 300) return false;
            StringBuilder out = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line; while ((line = br.readLine()) != null) out.append(line);
            }
            JSONObject session = new JSONObject(out.toString());
            String access = session.optString("access_token", "");
            String refresh = session.optString("refresh_token", refreshToken);
            if (access.length() < 20) return false;
            token = access; refreshToken = refresh;
            prefs.edit().putString("access_token", token).putString("refresh_token", refreshToken).apply();
            Log.i("BEXAlarm", "Therapist session refreshed successfully");
            return true;
        } catch (Exception e) { Log.w("BEXAlarm", "Session refresh failed", e); return false; }
        finally { if (c != null) c.disconnect(); }
    }

    private void startAlarm() {
        try {
            if (player != null && player.isPlaying()) return;
            if (player != null) { player.release(); player = null; }
            Uri sound = Settings.System.DEFAULT_ALARM_ALERT_URI;
            if (sound == null) sound = Settings.System.DEFAULT_NOTIFICATION_URI;
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.setVolume(1.0f, 1.0f);
            player.setOnPreparedListener(MediaPlayer::start);
            player.setOnErrorListener((mp, what, extra) -> { stopAlarm(); return true; });
            player.prepareAsync();
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = getSystemService(NotificationManager.class);
                nm.notify(NOTIFICATION_ID, buildStatusNotification("🔔 NEW JOB — tap Stop Alarm to silence"));
            }
        } catch (Exception e) { Log.e("BEXAlarm", "Alarm could not start", e); }
    }

    private void stopAlarm() {
        try { if (player != null) { if (player.isPlaying()) player.stop(); player.release(); player = null; } }
        catch (Exception ignored) { player = null; }
        updateStatus(dutyOn ? "Duty ON — waiting for next job" : "Duty OFF");
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "BodyExpertX New Duty Alarm", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Loud repeating alarm for newly assigned therapist jobs");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0,500,180,500,180,900,250,500,180,900});
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setSound(Settings.System.DEFAULT_ALARM_ALERT_URI, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    private Notification buildStatusNotification(String message) {
        Intent stop = new Intent(this, StopAlarmReceiver.class);
        PendingIntent stopPending = PendingIntent.getBroadcast(this, 4402, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("BodyExpertX Therapist")
            .setContentText(message)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "STOP ALARM", stopPending)
            .build();
    }
    private void updateStatus(String message) {
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildStatusNotification(message));
    }
    @Override public void onDestroy() {
        dutyOn = false; handler.removeCallbacks(poller); handler.removeCallbacks(wakeRenewal); stopAlarm();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        worker.shutdownNow(); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
