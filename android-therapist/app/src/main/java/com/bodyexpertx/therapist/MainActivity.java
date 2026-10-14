package com.bodyexpertx.therapist;

import android.Manifest;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.widget.Toast;

public class MainActivity extends Activity {
    private WebView web;
    private String pendingRefreshToken = "";
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 41);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new NativeBridge(), "BEXNativeAlarm");
        setContentView(web);
        web.loadUrl("https://bodyexpertx-therapist.onrender.com/?nativeAlarm=1");
    }
    private class NativeBridge {
        @JavascriptInterface public void syncSession(String token, boolean available) {
            if (token == null || token.length() < 20) return;
            Intent i = new Intent(MainActivity.this, AlertService.class);
            i.setAction(available ? AlertService.ACTION_START : AlertService.ACTION_DUTY_OFF);
            i.putExtra("token", token);
            if (pendingRefreshToken.length() > 20) i.putExtra("refresh_token", pendingRefreshToken);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
        }
        @JavascriptInterface public void syncRefreshToken(String refreshToken) {
            if (refreshToken == null || refreshToken.length() < 20) return;
            pendingRefreshToken = refreshToken;
            getSharedPreferences("bex_alarm", MODE_PRIVATE).edit().putString("refresh_token", refreshToken).apply();
            Intent i = new Intent(MainActivity.this, AlertService.class);
            i.setAction(AlertService.ACTION_UPDATE_REFRESH);
            i.putExtra("refresh_token", refreshToken);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
        }
        @JavascriptInterface public void stopAlarm() {
            Intent i = new Intent(MainActivity.this, AlertService.class);
            i.setAction(AlertService.ACTION_STOP_ALARM);
            startService(i);
        }
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
