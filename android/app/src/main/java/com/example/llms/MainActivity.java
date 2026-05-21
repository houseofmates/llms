package com.example.llms;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
 private boolean bridgeAdded = false;
 private FrameLayout webViewContainer;
 private WebView overlayWebView;
 private ProgressBar overlayProgress;
 private LinearLayout headerBar;
 private TextView headerTitle;
 private int statusBarHeight = 0;
 private LlamaServerService llamaService;
 private boolean llamaBound = false;

 private ServiceConnection llamaConnection = new ServiceConnection() {
 @Override
 public void onServiceConnected(ComponentName name, IBinder service) {
 LlamaServerService.LocalBinder binder = (LlamaServerService.LocalBinder) service;
 llamaService = binder.getService();
 llamaBound = true;
 }
 @Override
 public void onServiceDisconnected(ComponentName name) {
 llamaService = null;
 llamaBound = false;
 }
 };

 public class AndroidBridge {
 @JavascriptInterface
 public void openUrl(String url, String title) {
 runOnUiThread(() -> showOverlayWebView(url));
 }

 @JavascriptInterface
 public String getLlamaServerStatus() {
 if (!llamaBound || llamaService == null) return "not_bound";
 return llamaService.getStatus();
 }

 @JavascriptInterface
 public String getDetailedStatus() {
 if (!llamaBound || llamaService == null) return "{}";
 return llamaService.getDetailedStatusJson();
 }

 @JavascriptInterface
 public void startLlamaModelDownload() {
 if (llamaBound && llamaService != null) {
 llamaService.startManualDownload();
 }
 }
 }
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | 
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
        }
        
 setupOverlayWebView();
 setupBackNavigation();
 handleDeepLink(getIntent());

 // Start and bind to LlamaServerService
 Intent svcIntent = new Intent(this, LlamaServerService.class);
 startForegroundService(svcIntent);
 bindService(svcIntent, llamaConnection, Context.BIND_AUTO_CREATE);
 }

 @Override
 public void onDestroy() {
 super.onDestroy();
 if (llamaBound) {
 unbindService(llamaConnection);
 llamaBound = false;
 }
 }
    
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleDeepLink(intent);
    }
    
    private void handleDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        
        Uri uri = intent.getData();
        String scheme = uri.getScheme();
        String host = uri.getHost();
        
        if (scheme == null || host == null) return;
        
        if (scheme.equals("https") && isLLMDomain(host)) {
            showOverlayWebView(uri.toString());
        }
    }
    
    private boolean isLLMDomain(String host) {
        String[] domains = {
            "grok.com", "x.com", "twitter.com", "chatgpt.com", "claude.ai",
            "gemini.google.com", "chat.deepseek.com", "deepseek.com", "duck.ai",
            "duckduckgo.com", "copilot.microsoft.com", "perplexity.ai",
            "mistral.ai", "chat.mistral.ai", "you.com", "lmarena.ai",
            "consensus.app", "kimi.moonshot.cn", "agent.minimax.io",
            "aistudio.google.com", "lumo.proton.me",
            "blackbox.ai", "app.blackbox.ai"
        };
        
        for (String domain : domains) {
            if (host.equals(domain) || host.endsWith("." + domain)) {
                return true;
            }
        }
        return false;
    }
    
    private void setupBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webViewContainer != null && webViewContainer.getVisibility() == View.VISIBLE) {
                    if (overlayWebView != null && overlayWebView.canGoBack()) {
                        overlayWebView.goBack();
                    } else {
                        hideOverlayWebView();
                    }
                } else {
                    // Let the default behavior handle it (Capacitor WebView back, etc.)
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }
    
    private void setupOverlayWebView() {
        FrameLayout rootView = (FrameLayout) findViewById(android.R.id.content);
        float dp = getResources().getDisplayMetrics().density;
        
        // outer container that covers the whole screen
        webViewContainer = new FrameLayout(this);
        webViewContainer.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        webViewContainer.setBackgroundColor(0xFF050505);
        webViewContainer.setVisibility(View.GONE);
        
        // vertical layout: header bar on top, WebView below
        LinearLayout verticalLayout = new LinearLayout(this);
        verticalLayout.setOrientation(LinearLayout.VERTICAL);
        verticalLayout.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        
        // --- header bar ---
        headerBar = new LinearLayout(this);
        headerBar.setOrientation(LinearLayout.VERTICAL);
        headerBar.setBackgroundColor(0xFF111111);
        LinearLayout.LayoutParams headerParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        headerBar.setLayoutParams(headerParams);
        
        // row inside header: close button + title
        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);
        headerRow.setPadding((int)(8 * dp), 0, (int)(8 * dp), 0);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        headerRow.setLayoutParams(rowParams);
        
        // X close button
        ImageButton closeBtn = new ImageButton(this);
        closeBtn.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        closeBtn.setColorFilter(0xFFF5AF12);
        closeBtn.setBackgroundColor(0x00000000);
        int btnSize = (int)(28 * dp);
        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(btnSize, btnSize);
        closeBtn.setLayoutParams(btnParams);
        closeBtn.setPadding((int)(2 * dp), (int)(2 * dp), (int)(2 * dp), (int)(2 * dp));
        closeBtn.setOnClickListener(v -> hideOverlayWebView());
        
        // title text
        headerTitle = new TextView(this);
        headerTitle.setTextColor(0xAAFFFFFF);
        headerTitle.setTextSize(13);
        headerTitle.setSingleLine(true);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
        );
        titleParams.setMarginStart((int)(8 * dp));
        headerTitle.setLayoutParams(titleParams);
        
        headerRow.addView(closeBtn);
        headerRow.addView(headerTitle);
        headerBar.addView(headerRow);
        
        // progress bar inside header (at the bottom edge)
        overlayProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, (int)(3 * dp)
        );
        overlayProgress.setLayoutParams(progressParams);
        overlayProgress.setBackgroundColor(0xFF222222);
        overlayProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFF5AF12));
        headerBar.addView(overlayProgress);
        
        // listen for window insets to add status bar padding to the header row
        ViewCompat.setOnApplyWindowInsetsListener(headerBar, (v, insets) -> {
            Insets sysInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            statusBarHeight = sysInsets.top;
            // add status bar padding to header row so X button is clickable and not obscured
            int paddingTop = statusBarHeight > 0 ? Math.max(statusBarHeight - (int)(8 * dp), (int)(4 * dp)) : (int)(4 * dp);
            headerRow.setPadding((int)(8 * dp), paddingTop, (int)(8 * dp), (int)(4 * dp));
            return insets;
        });
        
        // --- WebView ---
        overlayWebView = new WebView(this);
        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        );
        overlayWebView.setLayoutParams(webParams);
        
        WebSettings s = overlayWebView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(overlayWebView, true);
        
        s.setUserAgentString("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36");
        
        overlayWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (headerTitle != null) {
                    try {
                        Uri uri = Uri.parse(url);
                        headerTitle.setText(uri.getHost());
                    } catch (Exception e) {
                        headerTitle.setText(url);
                    }
                }
            }
        });
        overlayWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                overlayProgress.setProgress(newProgress);
                overlayProgress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
            }
        });
        
        overlayWebView.setBackgroundColor(0xFFFFFFFF);
        
        // assemble: header on top, then WebView
        verticalLayout.addView(headerBar);
        verticalLayout.addView(overlayWebView);
        webViewContainer.addView(verticalLayout);
        
        rootView.addView(webViewContainer);
    }
    
    public void showOverlayWebView(String url) {
        if (overlayWebView == null || webViewContainer == null) return;
        overlayWebView.loadUrl(url);
        webViewContainer.setVisibility(View.VISIBLE);
        webViewContainer.bringToFront();
        if (headerTitle != null) {
            try {
                Uri uri = Uri.parse(url);
                headerTitle.setText(uri.getHost());
            } catch (Exception e) {
                headerTitle.setText("");
            }
        }
        overlayProgress.setVisibility(View.VISIBLE);
        overlayProgress.setProgress(0);
    }
    
    public void hideOverlayWebView() {
        if (webViewContainer != null) {
            webViewContainer.setVisibility(View.GONE);
        }
        if (overlayWebView != null) {
            overlayWebView.stopLoading();
            overlayWebView.loadUrl("about:blank");
        }
        WebView capWebView = getBridge().getWebView();
        if (capWebView != null) {
            capWebView.evaluateJavascript("if (typeof goHome === 'function') goHome();", null);
        }
    }
    
    @Override
    public void onResume() {
        super.onResume();
        WebView capWebView = getBridge().getWebView();
        if (capWebView != null && !bridgeAdded) {
            capWebView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
            bridgeAdded = true;
        }
        
        if (webViewContainer != null && webViewContainer.getVisibility() == View.VISIBLE) {
            return;
        }
        if (capWebView != null) {
            capWebView.evaluateJavascript("if (typeof goHome === 'function') goHome();", null);
        }
    }
}
