package com.conova.music;

import android.app.Activity;
import android.content.Intent;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ConovaNative")
public class ConovaNativePlugin extends Plugin {
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private NativeStateStore store;
    private boolean loggingIn;

    @Override public void load() { store = new NativeStateStore(getContext()); }

    @PluginMethod public void request(PluginCall call) {
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                JSObject headers = call.getObject("headers", new JSObject());
                connection = NativeNetwork.open(call.getString("url"), "api", headers.optString("Cookie", ""), null, false);
                int status = connection.getResponseCode();
                String data = NativeNetwork.read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                JSArray cookies = new JSArray();
                for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                    if ("set-cookie".equalsIgnoreCase(entry.getKey())) for (String cookie : entry.getValue()) cookies.put(cookie);
                }
                call.resolve(new JSObject().put("status", status).put("data", data).put("setCookies", cookies));
            } catch (Exception error) { call.reject("暂时无法连接 B 站，请检查网络后重试。"); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }

    @PluginMethod public void readState(PluginCall call) {
        executor.execute(() -> {
            try { String value = store.read(); JSObject result = new JSObject(); if (value != null) result.put("value", value); call.resolve(result); }
            catch (Exception error) { call.reject("无法读取本机登录数据。"); }
        });
    }

    @PluginMethod public void writeState(PluginCall call) {
        String value = call.getString("value");
        if (value == null) { call.reject("本机数据为空。"); return; }
        executor.execute(() -> {
            try { store.write(value); call.resolve(); }
            catch (Exception error) { call.reject("无法保存本机登录数据，请检查存储空间。"); }
        });
    }

    @PluginMethod public void registerAudio(PluginCall call) {
        try {
            JSArray values = call.getArray("backups", new JSArray());
            List<String> backups = new ArrayList<>();
            for (int index = 0; index < values.length(); index++) if (values.opt(index) instanceof String) backups.add(values.getString(index));
            call.resolve(new JSObject().put("url", NativeMedia.register(call.getString("url"), call.getString("cookie", ""), backups)));
        }
        catch (Exception error) { call.reject("音频地址无效。"); }
    }

    @PluginMethod public void clearMedia(PluginCall call) { NativeMedia.clear(); call.resolve(); }

    @PluginMethod public void login(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (loggingIn) { call.resolve(new JSObject().put("cancelled", true)); return; }
            loggingIn = true;
            startActivityForResult(call, new Intent(getContext(), BiliLoginActivity.class), "loginResult");
        });
    }

    @ActivityCallback private void loginResult(PluginCall call, ActivityResult result) {
        loggingIn = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
        call.resolve(new JSObject().put("cookies", result.getData().getStringExtra("cookies")));
    }

    @PluginMethod public void clearLogin(PluginCall call) {
        getActivity().runOnUiThread(() -> CookieManager.getInstance().removeAllCookies((removed) -> { CookieManager.getInstance().flush(); call.resolve(); }));
    }

    @Override protected void handleOnDestroy() { executor.shutdownNow(); NativeMedia.clear(); }
}
