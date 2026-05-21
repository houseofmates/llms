package com.example.llms;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import android.content.ComponentName;
import java.util.List;

public class InAppBrowserActivity extends AppCompatActivity {
    private static final int CUSTOM_TABS_REQUEST = 1001;
    private CustomTabsSession customTabsSession;
    private String startUrl;
    private ProgressBar progressBar;
    private boolean launched = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        startUrl = getIntent().getStringExtra("url");
        
        // Simple loading UI
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(0xFF050505);
        
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 8
        ));
        progressBar.setBackgroundColor(0xFF333333);
        progressBar.getIndeterminateDrawable().setColorFilter(
            Color.parseColor("#F5AF12"), android.graphics.PorterDuff.Mode.SRC_IN
        );
        progressBar.setIndeterminate(true);
        layout.addView(progressBar);
        
        setContentView(layout);
        
        // Setup back navigation
        setupBackNavigation();
        
        // Open Custom Tabs immediately
        openCustomTabs();
    }
    
    private void openCustomTabs() {
        // Build Custom Tabs intent
        CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();
        
        // Force dark mode for Custom Tabs
        builder.setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK);
        
        // Visual customization
        builder.setToolbarColor(0xFF050505);
        builder.setSecondaryToolbarColor(0xFF111111);
        builder.setShowTitle(true);
        builder.setUrlBarHidingEnabled(false);
        
        // Animations
        builder.setStartAnimations(this, android.R.anim.fade_in, android.R.anim.fade_out);
        builder.setExitAnimations(this, android.R.anim.fade_in, android.R.anim.fade_out);
        
        // Build the intent
        CustomTabsIntent customTabsIntent = builder.build();
        
        // Try to find Chrome specifically for Custom Tabs
        String chromePackage = getChromePackage();
        if (chromePackage != null) {
            customTabsIntent.intent.setPackage(chromePackage);
        }
        
        // Ensure we don't open in a new task (keeps it feeling like part of the app)
        customTabsIntent.intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
        
        try {
            // Launch the URL
            customTabsIntent.launchUrl(this, Uri.parse(startUrl));
            launched = true;
        } catch (Exception e) {
            // If Custom Tabs fails, open as regular browser but still within app flow
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(startUrl));
            browserIntent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
            startActivity(browserIntent);
            launched = true;
        }
    }
    
    private String getChromePackage() {
        // Try to find Chrome or Chromium packages that support Custom Tabs
        String[] packages = {
            "com.android.chrome",
            "com.chrome.beta", 
            "com.chrome.dev",
            "com.chrome.canary",
            "com.google.android.apps.chrome",
            "org.chromium.chrome"
        };
        
        PackageManager pm = getPackageManager();
        
        for (String pkg : packages) {
            try {
                // Check if package exists and supports Custom Tabs
                pm.getPackageInfo(pkg, 0);
                
                // Check if it can handle VIEW intents
                Intent intent = new Intent();
                intent.setAction(Intent.ACTION_VIEW);
                intent.setPackage(pkg);
                intent.setData(Uri.parse("https://www.example.com"));
                
                List<ResolveInfo> activities = pm.queryIntentActivities(intent, 0);
                if (activities != null && !activities.isEmpty()) {
                    return pkg;
                }
            } catch (Exception e) {
                // Package not found, try next
            }
        }
        
        // Return null to use default browser
        return null;
    }
    
    private void setupBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                finish();
            }
        });
    }
    
    @Override
    protected void onResume() {
        super.onResume();
        // If we already launched and are resuming, user closed Custom Tabs
        if (launched) {
            finish();
        }
    }
}
