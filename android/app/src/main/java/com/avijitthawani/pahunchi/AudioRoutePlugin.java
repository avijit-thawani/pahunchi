package com.avijitthawani.pahunchi;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;
import java.util.List;

/**
 * Routes call audio the way a phone dialer does: Bluetooth headset, else wired/USB headset, else
 * earpiece, or the loudspeaker while Speaker is on. Re-routes when headsets come and go. While the
 * earpiece is in use the proximity sensor blanks the screen, so a cheek can't press buttons.
 * Used by src/lib/route.ts.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private static final List<Integer> BLUETOOTH = Arrays.asList(
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO, 26 /* TYPE_BLE_HEADSET */, 27 /* TYPE_BLE_SPEAKER */);
    private static final List<Integer> WIRED = Arrays.asList(
            AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE);

    private final Handler main = new Handler(Looper.getMainLooper());
    private AudioManager am;
    private PowerManager.WakeLock proximity;
    private boolean active = false;
    private boolean speaker = false;
    private String route = "earpiece";

    // Chromium picks its own device when the mic opens or a headset appears; re-apply ours after it.
    private final Runnable reapply = this::apply;

    private final AudioDeviceCallback devices = new AudioDeviceCallback() {
        @Override
        public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
            schedule();
        }

        @Override
        public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            schedule();
        }
    };

    @Override
    public void load() {
        am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "phoney:call");
            proximity.setReferenceCounted(false);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        speaker = call.getBoolean("speaker", false);
        main.post(() -> {
            if (!active) {
                active = true;
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.registerAudioDeviceCallback(devices, main);
            }
            apply();
            schedule();
            call.resolve(result());
        });
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        speaker = call.getBoolean("speaker", false);
        main.post(() -> {
            if (active) apply();
            call.resolve(result());
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            release();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        release();
    }

    private void release() {
        if (!active) return;
        active = false;
        main.removeCallbacks(reapply);
        am.unregisterAudioDeviceCallback(devices);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.clearCommunicationDevice();
        } else {
            if (am.isBluetoothScoOn()) am.stopBluetoothSco();
            am.setBluetoothScoOn(false);
            am.setSpeakerphoneOn(false);
        }
        am.setMode(AudioManager.MODE_NORMAL);
        if (proximity != null) proximity.release();
    }

    private void schedule() {
        main.removeCallbacks(reapply);
        main.postDelayed(reapply, 400);
        main.postDelayed(reapply, 1500);
    }

    private JSObject result() {
        JSObject r = new JSObject();
        r.put("route", route);
        return r;
    }

    private void apply() {
        if (!active) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) applyPostS();
        else applyPreS();
        if (proximity != null) {
            if (route.equals("earpiece")) proximity.acquire();
            else proximity.release();
        }
        notifyListeners("route", result());
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private void applyPostS() {
        List<AudioDeviceInfo> available = am.getAvailableCommunicationDevices();
        AudioDeviceInfo target = null;
        String name = "earpiece";
        if (speaker) {
            target = find(available, Arrays.asList(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER));
            name = "speaker";
        }
        if (target == null) {
            target = find(available, BLUETOOTH);
            name = "bluetooth";
        }
        if (target == null) {
            target = find(available, WIRED);
            name = "headset";
        }
        if (target == null) {
            target = find(available, Arrays.asList(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE));
            name = "earpiece";
        }
        if (target == null) return;
        route = name;
        AudioDeviceInfo current = am.getCommunicationDevice();
        if (current == null || current.getId() != target.getId()) am.setCommunicationDevice(target);
    }

    private void applyPreS() {
        AudioDeviceInfo[] outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        List<AudioDeviceInfo> list = Arrays.asList(outputs);
        boolean bt = find(list, BLUETOOTH) != null;
        boolean wired = find(list, WIRED) != null;
        if (speaker) route = "speaker";
        else if (bt) route = "bluetooth";
        else if (wired) route = "headset";
        else route = "earpiece";

        am.setSpeakerphoneOn(route.equals("speaker"));
        if (route.equals("bluetooth")) {
            if (!am.isBluetoothScoOn()) {
                am.startBluetoothSco();
                am.setBluetoothScoOn(true);
            }
        } else if (am.isBluetoothScoOn()) {
            am.setBluetoothScoOn(false);
            am.stopBluetoothSco();
        }
    }

    private static AudioDeviceInfo find(List<AudioDeviceInfo> devices, List<Integer> types) {
        for (int type : types) {
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == type) return d;
            }
        }
        return null;
    }
}
