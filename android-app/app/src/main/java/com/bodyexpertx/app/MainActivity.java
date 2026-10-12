package com.bodyexpertx.app;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.content.Intent;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;
import android.text.InputType;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final String WEBSITE = "https://jitenderkusum8098-creator.github.io/Bodyexpertx/";
    private static final String WHATSAPP_NUMBER = "917838675115";
    private LinearLayout root;
    private WebView webView;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        showHome();
    }

    private int dp(int value) { return (int)(value * getResources().getDisplayMetrics().density); }
    private GradientDrawable rounded(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color); d.setCornerRadius(dp(14)); return d;
    }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value); t.setTextSize(size); t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        t.setGravity(Gravity.CENTER_VERTICAL);
        return t;
    }
    private Button button(String label, boolean primary, View.OnClickListener click) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false);
        b.setTextSize(16); b.setOnClickListener(click);
        b.setTextColor(primary ? Color.BLACK : Color.WHITE);
        b.setBackground(rounded(primary ? Color.rgb(212,167,44) : Color.rgb(40,40,40)));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(54));
        p.bottomMargin = dp(12); b.setLayoutParams(p); return b;
    }
    private void base(String title) {
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(17,17,17));
        root.setPadding(dp(20), dp(18), dp(20), dp(16));
        TextView brand = text("BX  BodyExpertX", 24, Color.rgb(212,167,44), true);
        root.addView(brand, new LinearLayout.LayoutParams(-1, dp(42)));
        TextView heading = text(title, 21, Color.WHITE, true);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(-1, dp(48)); hp.topMargin=dp(10);
        root.addView(heading, hp);
        setContentView(root);
    }
    private void showHome() {
        base("Relax  •  Recover  •  Rejuvenate");
        TextView intro = text("Professional massage and salon services. Choose a service, request a booking, or chat with our team.", 15, Color.LTGRAY, false);
        intro.setGravity(Gravity.TOP);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(-1, dp(90)); ip.topMargin=dp(6); ip.bottomMargin=dp(16);
        root.addView(intro, ip);
        root.addView(button("Explore services on BodyExpertX", true, v -> showWebsite()));
        root.addView(button("Book an appointment (form)", true, v -> showBookingForm()));
        root.addView(button("Book directly on WhatsApp", false, v -> openWhatsApp("Hello BodyExpertX, I would like to enquire about a booking.")));
        TextView note = text("Your existing website remains unchanged. Booking requests are sent to WhatsApp for confirmation.", 13, Color.LTGRAY, false);
        note.setGravity(Gravity.TOP);
        LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(-1, dp(70)); np.topMargin=dp(10);
        root.addView(note, np);
    }
    private void showWebsite() {
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setPadding(dp(8),0,dp(8),0); bar.setBackgroundColor(Color.rgb(17,17,17));
        Button back = new Button(this); back.setText("← App"); back.setAllCaps(false); back.setTextColor(Color.WHITE); back.setBackgroundColor(Color.TRANSPARENT);
        back.setOnClickListener(v -> showHome()); bar.addView(back);
        TextView label = text("BodyExpertX", 17, Color.rgb(212,167,44), true); bar.addView(label);
        root.addView(bar, new LinearLayout.LayoutParams(-1,dp(52)));
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                String scheme=uri.getScheme()==null?"":uri.getScheme();
                if (!scheme.equals("https") && !scheme.equals("http")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch(Exception ignored) {}
                    return true;
                }
                if (uri.getHost()!=null && !uri.getHost().equals("jitenderkusum8098-creator.github.io")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch(Exception ignored) {}
                    return true;
                }
                return false;
            }
        });
        webView.loadUrl(WEBSITE);
        root.addView(webView, new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout bottom = new LinearLayout(this); bottom.setPadding(dp(8),dp(6),dp(8),dp(6)); bottom.setBackgroundColor(Color.rgb(17,17,17));
        Button form = new Button(this); form.setText("Booking Form"); form.setAllCaps(false); form.setTextColor(Color.BLACK); form.setBackground(rounded(Color.rgb(212,167,44)));
        form.setOnClickListener(v -> showBookingForm()); bottom.addView(form,new LinearLayout.LayoutParams(0,dp(48),1));
        Button wa = new Button(this); wa.setText("WhatsApp"); wa.setAllCaps(false); wa.setTextColor(Color.WHITE); wa.setBackground(rounded(Color.rgb(37,211,102)));
        wa.setOnClickListener(v -> openWhatsApp("Hello BodyExpertX, I would like to enquire about a booking.")); LinearLayout.LayoutParams wp=new LinearLayout.LayoutParams(0,dp(48),1); wp.leftMargin=dp(8); bottom.addView(wa,wp);
        root.addView(bottom);
        setContentView(root);
    }
    private EditText field(String hint, int inputType) {
        EditText e = new EditText(this); e.setSingleLine(inputType!=InputType.TYPE_CLASS_TEXT | hint.equals("Additional details (optional)"));
        e.setHint(hint); e.setTextColor(Color.WHITE); e.setHintTextColor(Color.LTGRAY); e.setInputType(inputType);
        e.setPadding(dp(12),dp(8),dp(12),dp(8)); e.setBackground(rounded(Color.rgb(42,42,42)));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(52)); p.bottomMargin=dp(10); e.setLayoutParams(p); return e;
    }
    private void showBookingForm() {
        base("Appointment request");
        ScrollView scroll=new ScrollView(this);
        LinearLayout form=new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(0,dp(4),0,0);
        TextView hint=text("Fill in your details. WhatsApp will open with your request ready to send.",14,Color.LTGRAY,false);
        LinearLayout.LayoutParams h=new LinearLayout.LayoutParams(-1,dp(54)); form.addView(hint,h);
        EditText name=field("Full name",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS); form.addView(name);
        EditText phone=field("10-digit mobile number",InputType.TYPE_CLASS_PHONE); form.addView(phone);
        Spinner service=new Spinner(this);
        String[] services={"Select service","Swedish Massage","Deep Tissue Massage","Sports Massage","Hot Stone Massage","Cupping Therapy","Salon service","Other"};
        ArrayAdapter<String> adapter=new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,services);
        service.setAdapter(adapter); service.setBackground(rounded(Color.rgb(42,42,42)));
        LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,dp(52)); sp.bottomMargin=dp(10); form.addView(service,sp);
        EditText date=field("Preferred date (e.g. 25 Oct)",InputType.TYPE_CLASS_TEXT); form.addView(date);
        EditText time=field("Preferred time",InputType.TYPE_CLASS_TEXT); form.addView(time);
        EditText area=field("Your area / locality",InputType.TYPE_CLASS_TEXT); form.addView(area);
        EditText details=field("Additional details (optional)",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE); details.setSingleLine(false); details.setMinLines(2); form.addView(details);
        form.addView(button("Send booking request on WhatsApp",true,v -> {
            String n=name.getText().toString().trim(), p=phone.getText().toString().replaceAll("\\D","");
            if(n.isEmpty() || p.length()!=10 || service.getSelectedItemPosition()==0) {
                Toast.makeText(this,"Please enter your name, valid 10-digit phone and service.",Toast.LENGTH_LONG).show(); return;
            }
            String msg="*BodyExpertX Booking Request*\nName: "+n+"\nCustomer phone: "+p+"\nService: "+service.getSelectedItem().toString()+"\nPreferred date: "+date.getText().toString().trim()+"\nPreferred time: "+time.getText().toString().trim()+"\nArea: "+area.getText().toString().trim()+"\nDetails: "+details.getText().toString().trim()+"\n\nPlease confirm availability and final price.";
            openWhatsApp(msg);
        }));
        form.addView(button("Back to app",false,v -> showHome()));
        scroll.addView(form); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    }
    private void openWhatsApp(String message) {
        try {
            String url="https://wa.me/"+WHATSAPP_NUMBER+"?text="+URLEncoder.encode(message, StandardCharsets.UTF_8.name());
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch(Exception e) {
            Toast.makeText(this,"WhatsApp ya browser khol nahi paaye. Dobara try karein.",Toast.LENGTH_LONG).show();
        }
    }
    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) { webView.goBack(); return; }
        showHome();
    }
}
