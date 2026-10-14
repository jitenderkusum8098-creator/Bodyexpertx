package com.bodyexpertx.therapist;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class StopAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        Intent i = new Intent(context, AlertService.class);
        i.setAction(AlertService.ACTION_STOP_ALARM);
        context.startService(i);
    }
}
