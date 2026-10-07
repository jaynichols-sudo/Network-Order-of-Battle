package com.jaynichols.networkoob;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setIntent(asView(getIntent()));
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        Intent view = asView(intent);
        setIntent(view);
        super.onNewIntent(view);
    }

    /**
     * Capacitor's App plugin only reports VIEW intents (appUrlOpen). A file shared to
     * Bearings arrives as SEND with the file in EXTRA_STREAM, so hand it on as a VIEW
     * of that file; the web app then reads it like any other opened file.
     */
    @SuppressWarnings("deprecation")
    private static Intent asView(Intent in) {
        if (in == null || !Intent.ACTION_SEND.equals(in.getAction())) return in;
        Uri stream = in.getParcelableExtra(Intent.EXTRA_STREAM);
        if (stream == null) {
            // Meeting notes shared as text (Plaud, Keep, Samsung Notes): the web app reads
            // them from bearings://notes and opens the meeting notes sheet.
            CharSequence text = in.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text == null || text.length() == 0) return in;
            String body = text.toString();
            if (body.length() > 60000) body = body.substring(0, 60000);
            CharSequence subject = in.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
            if (subject != null && subject.length() > 0 && !body.startsWith(subject.toString())) body = subject + "\n\n" + body;
            Uri.Builder u = new Uri.Builder().scheme("bearings").authority("notes").appendQueryParameter("text", body);
            String from = in.getStringExtra(Intent.EXTRA_TITLE);
            if (from != null) u.appendQueryParameter("from", from);
            Intent view = new Intent(Intent.ACTION_VIEW, u.build());
            return view;
        }
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(stream, in.getType());
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return view;
    }
}
