package space.houseofmates.llms;

import android.app.Activity;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.AlarmClock;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AssistActivity extends Activity {
    private static final String TAG = "LlmsAssist";
    
    private SpeechRecognizer speechRecognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private ExecutorService executor;
    private Handler mainHandler;
    
    // UI elements
    private TextView statusText;
    private TextView userQueryText;
    private TextView responseText;
    private ProgressBar progressBar;
    private TextView micIndicator;
    private LinearLayout mainLayout;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.d(TAG, "AssistActivity created");
        
        executor = Executors.newSingleThreadExecutor();
        mainHandler = new Handler(Looper.getMainLooper());
        
        // Translucent overlay style
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        
        setupUI();
        setupTTS();
        
        // Handle the incoming intent
        handleAssistIntent(getIntent());
    }
    
    private void setupUI() {
        float dp = getResources().getDisplayMetrics().density;
        
        // Root frame with dark translucent background
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xE6000000); // 90% opacity black
        root.setOnClickListener(v -> finish()); // Tap outside to dismiss
        
        // Main card
        mainLayout = new LinearLayout(this);
        mainLayout.setOrientation(LinearLayout.VERTICAL);
        mainLayout.setPadding((int)(24*dp), (int)(32*dp), (int)(24*dp), (int)(24*dp));
        
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(0xFF111111);
        cardBg.setCornerRadii(new float[]{
            24*dp, 24*dp, 24*dp, 24*dp, 0, 0, 0, 0
        });
        mainLayout.setBackground(cardBg);
        mainLayout.setClickable(true); // Prevent click-through
        
        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        cardParams.gravity = Gravity.BOTTOM;
        mainLayout.setLayoutParams(cardParams);
        
        // Mic indicator / pulse
        micIndicator = new TextView(this);
        micIndicator.setText("listening...");
        micIndicator.setTextColor(0xFFF5AF12);
        micIndicator.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        micIndicator.setGravity(Gravity.CENTER);
        micIndicator.setPadding(0, 0, 0, (int)(16*dp));
        mainLayout.addView(micIndicator);
        
        // Status text
        statusText = new TextView(this);
        statusText.setText("say something...");
        statusText.setTextColor(0xFF999999);
        statusText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        statusText.setGravity(Gravity.CENTER);
        mainLayout.addView(statusText);
        
        // Progress bar
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        progressBar.setVisibility(View.GONE);
        LinearLayout.LayoutParams pbParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, (int)(4*dp)
        );
        pbParams.topMargin = (int)(8*dp);
        pbParams.bottomMargin = (int)(8*dp);
        progressBar.setLayoutParams(pbParams);
        mainLayout.addView(progressBar);
        
        // User query display
        userQueryText = new TextView(this);
        userQueryText.setTextColor(Color.WHITE);
        userQueryText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        userQueryText.setPadding(0, (int)(12*dp), 0, (int)(8*dp));
        userQueryText.setVisibility(View.GONE);
        mainLayout.addView(userQueryText);
        
        // Scrollable response area
        ScrollView scrollView = new ScrollView(this);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        );
        scrollParams.topMargin = (int)(8*dp);
        scrollView.setLayoutParams(scrollParams);
        // Limit scroll height via layout params instead of setMaxHeight
        
        responseText = new TextView(this);
        responseText.setTextColor(0xFFCCCCCC);
        responseText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        responseText.setPadding((int)(8*dp), (int)(8*dp), (int)(8*dp), (int)(8*dp));
        responseText.setVisibility(View.GONE);
        
        GradientDrawable responseBg = new GradientDrawable();
        responseBg.setColor(0xFF1A1A1A);
        responseBg.setCornerRadius(12*dp);
        responseText.setBackground(responseBg);
        
        scrollView.addView(responseText);
        mainLayout.addView(scrollView);
        
        // Action buttons row (will be populated dynamically)
        LinearLayout actionRow = new LinearLayout(this);
        actionRow.setId(android.R.id.widget_frame);
        actionRow.setOrientation(LinearLayout.HORIZONTAL);
        actionRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        actionParams.topMargin = (int)(12*dp);
        actionRow.setLayoutParams(actionParams);
        mainLayout.addView(actionRow);
        
        root.addView(mainLayout);
        setContentView(root);
    }
    
    private void setupTTS() {
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.US);
                ttsReady = true;
            }
        });
    }
    
    private void handleAssistIntent(Intent intent) {
        if (intent == null) {
            startListening();
            return;
        }
        
        String action = intent.getAction();
        Log.d(TAG, "Intent action: " + action);
        
        // Check for text query from assist
        String query = null;
        if (Intent.ACTION_ASSIST.equals(action) || "android.intent.action.VOICE_ASSIST".equals(action)) {
            // May contain existing text from search
            query = intent.getStringExtra(SearchManager.QUERY);
            if (query == null) {
                query = intent.getStringExtra(Intent.EXTRA_TEXT);
            }
        } else if (Intent.ACTION_SEARCH.equals(action)) {
            query = intent.getStringExtra(SearchManager.QUERY);
        }
        
        if (query != null && !query.isEmpty()) {
            // Already have text, process it
            processQuery(query);
        } else {
            // Start voice recognition
            startListening();
        }
    }
    
    private void startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            statusText.setText("speech recognition not available");
            return;
        }
        
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                micIndicator.setText("listening...");
                statusText.setText("speak now");
            }
            
            @Override
            public void onBeginningOfSpeech() {
                micIndicator.setText("hearing you...");
            }
            
            @Override
            public void onRmsChanged(float rmsdB) {}
            
            @Override
            public void onBufferReceived(byte[] buffer) {}
            
            @Override
            public void onEndOfSpeech() {
                micIndicator.setText("processing...");
                statusText.setText("thinking...");
            }
            
            @Override
            public void onError(int error) {
                String msg;
                switch (error) {
                    case SpeechRecognizer.ERROR_NO_MATCH:
                        msg = "didn't catch that. tap to try again.";
                        break;
                    case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                        msg = "no speech detected. tap to try again.";
                        break;
                    case SpeechRecognizer.ERROR_AUDIO:
                        msg = "audio error. check microphone.";
                        break;
                    case SpeechRecognizer.ERROR_NETWORK:
                    case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                        msg = "network error for speech recognition.";
                        break;
                    default:
                        msg = "speech error (" + error + "). tap to retry.";
                }
                statusText.setText(msg);
                micIndicator.setText("tap to speak");
                micIndicator.setOnClickListener(v -> startListening());
            }
            
            @Override
            public void onResults(Bundle results) {
                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    String query = matches.get(0);
                    processQuery(query);
                } else {
                    statusText.setText("didn't understand. tap to try again.");
                    micIndicator.setText("tap to speak");
                    micIndicator.setOnClickListener(v -> startListening());
                }
            }
            
            @Override
            public void onPartialResults(Bundle partialResults) {
                ArrayList<String> partial = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (partial != null && !partial.isEmpty()) {
                    userQueryText.setVisibility(View.VISIBLE);
                    userQueryText.setText(partial.get(0) + "...");
                }
            }
            
            @Override
            public void onEvent(int eventType, Bundle params) {}
        });
        
        Intent recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault());
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        
        try {
            speechRecognizer.startListening(recognizerIntent);
        } catch (SecurityException e) {
            statusText.setText("microphone permission required");
            // Request permission
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 1);
            }
        }
    }
    
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 1 && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startListening();
        }
    }
    
    private void processQuery(String query) {
        Log.d(TAG, "Processing query: " + query);
        
        userQueryText.setVisibility(View.VISIBLE);
        userQueryText.setText(query);
        micIndicator.setText("thinking...");
        statusText.setText("sending to ai...");
        progressBar.setVisibility(View.VISIBLE);
        
        // Build system prompt for assistant mode
        String systemPrompt = 
            "you are llms assistant, a helpful ai assistant on an android phone. " +
            "respond concisely and helpfully. when the user asks you to perform an action, " +
            "include an ACTION line at the end of your response in this exact format:\n" +
            "ACTION: {\"type\":\"action_type\",\"data\":\"value\"}\n\n" +
            "supported action types:\n" +
            "- search: web search. data = search query\n" +
            "- open_app: open an app. data = package name or app name\n" +
            "- open_url: open a URL. data = url\n" +
            "- set_alarm: set alarm. data = {\"hour\":H,\"minute\":M,\"message\":\"label\"}\n" +
            "- set_timer: set timer. data = {\"seconds\":S,\"message\":\"label\"}\n" +
            "- call: make phone call. data = phone number\n" +
            "- send_text: send sms. data = {\"number\":\"...\",\"message\":\"...\"}\n" +
            "- settings: open settings. data = setting name (wifi, bluetooth, display, etc.)\n" +
            "- none: no action needed\n\n" +
            "keep responses brief (1-3 sentences) unless asked for detail. " +
            "always lowercase. be direct and useful.";
        
        executor.execute(() -> {
            String response = queryModel(systemPrompt, query);
            mainHandler.post(() -> handleResponse(query, response));
        });
    }
    
    private String queryModel(String systemPrompt, String userQuery) {
        // Try local llama server first (port 5053)
        String localResponse = tryLocalServer(systemPrompt, userQuery);
        if (localResponse != null) return localResponse;
        
        // Try Gemini API
        String geminiResponse = tryGeminiApi(systemPrompt, userQuery);
        if (geminiResponse != null) return geminiResponse;
        
        // Try OpenRouter
        String orResponse = tryOpenRouter(systemPrompt, userQuery);
        if (orResponse != null) return orResponse;
        
        return "i couldn't connect to any ai model. please check your api keys in the llms app settings, or download the offline model.";
    }
    
    private String tryLocalServer(String systemPrompt, String userQuery) {
        try {
            URL url = new URL("http://127.0.0.1:5053/v1/chat/completions");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(30000);
            conn.setDoOutput(true);
            
            JSONObject body = new JSONObject();
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", systemPrompt));
            messages.put(new JSONObject().put("role", "user").put("content", userQuery));
            body.put("messages", messages);
            body.put("max_tokens", 256);
            body.put("temperature", 0.7);
            body.put("stream", false);
            
            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.close();
            
            if (conn.getResponseCode() == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();
                
                JSONObject resp = new JSONObject(sb.toString());
                return resp.getJSONArray("choices").getJSONObject(0)
                    .getJSONObject("message").getString("content");
            }
        } catch (Exception e) {
            Log.d(TAG, "Local server not available: " + e.getMessage());
        }
        return null;
    }
    
    private String tryGeminiApi(String systemPrompt, String userQuery) {
        try {
            // Read API key from SharedPreferences (stored by the web app via localStorage bridge)
            String apiKey = getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .getString("llms_api_keys", null);
            if (apiKey == null) return null;
            
            JSONObject keys = new JSONObject(apiKey);
            String geminiKey = keys.optString("gemini", "");
            if (geminiKey.isEmpty()) return null;
            
            URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiKey);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(30000);
            conn.setDoOutput(true);
            
            JSONObject body = new JSONObject();
            JSONArray contents = new JSONArray();
            JSONObject userPart = new JSONObject();
            JSONArray parts = new JSONArray();
            parts.put(new JSONObject().put("text", systemPrompt + "\n\nUser: " + userQuery));
            userPart.put("parts", parts);
            contents.put(userPart);
            body.put("contents", contents);
            
            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.close();
            
            if (conn.getResponseCode() == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();
                
                JSONObject resp = new JSONObject(sb.toString());
                return resp.getJSONArray("candidates").getJSONObject(0)
                    .getJSONObject("content").getJSONArray("parts")
                    .getJSONObject(0).getString("text");
            }
        } catch (Exception e) {
            Log.d(TAG, "Gemini API failed: " + e.getMessage());
        }
        return null;
    }
    
    private String tryOpenRouter(String systemPrompt, String userQuery) {
        try {
            String apiKey = getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .getString("llms_api_keys", null);
            if (apiKey == null) return null;
            
            JSONObject keys = new JSONObject(apiKey);
            String orKey = keys.optString("openrouter", "");
            if (orKey.isEmpty()) return null;
            
            URL url = new URL("https://openrouter.ai/api/v1/chat/completions");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + orKey);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(30000);
            conn.setDoOutput(true);
            
            JSONObject body = new JSONObject();
            body.put("model", "meta-llama/llama-3.1-8b-instruct:free");
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", systemPrompt));
            messages.put(new JSONObject().put("role", "user").put("content", userQuery));
            body.put("messages", messages);
            body.put("max_tokens", 256);
            
            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.close();
            
            if (conn.getResponseCode() == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();
                
                JSONObject resp = new JSONObject(sb.toString());
                return resp.getJSONArray("choices").getJSONObject(0)
                    .getJSONObject("message").getString("content");
            }
        } catch (Exception e) {
            Log.d(TAG, "OpenRouter failed: " + e.getMessage());
        }
        return null;
    }
    
    private void handleResponse(String query, String response) {
        progressBar.setVisibility(View.GONE);
        micIndicator.setText("done");
        statusText.setText("tap anywhere to dismiss");
        
        // Parse out ACTION line if present
        String displayResponse = response;
        String actionJson = null;
        
        int actionIdx = response.indexOf("ACTION:");
        if (actionIdx >= 0) {
            String actionLine = response.substring(actionIdx + 7).trim();
            displayResponse = response.substring(0, actionIdx).trim();
            
            // Extract JSON from action line
            int jsonStart = actionLine.indexOf('{');
            int jsonEnd = actionLine.lastIndexOf('}');
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                actionJson = actionLine.substring(jsonStart, jsonEnd + 1);
            }
        }
        
        responseText.setVisibility(View.VISIBLE);
        responseText.setText(displayResponse);
        
        // Speak the response
        if (ttsReady && displayResponse.length() < 200) {
            tts.speak(displayResponse, TextToSpeech.QUEUE_FLUSH, null, "assist_response");
        }
        
        // Execute action if found
        if (actionJson != null) {
            executeAction(actionJson);
        }
        
        // Allow tap to speak again
        micIndicator.setOnClickListener(v -> {
            responseText.setVisibility(View.GONE);
            userQueryText.setVisibility(View.GONE);
            startListening();
        });
    }
    
    private void executeAction(String actionJsonStr) {
        try {
            JSONObject action = new JSONObject(actionJsonStr);
            String type = action.optString("type", "none");
            String data = action.optString("data", "");
            
            Log.d(TAG, "Executing action: " + type + " data: " + data);
            
            float dp = getResources().getDisplayMetrics().density;
            LinearLayout actionRow = mainLayout.findViewById(android.R.id.widget_frame);
            actionRow.removeAllViews();
            
            switch (type) {
                case "search":
                    addActionButton(actionRow, "search: " + data, dp, () -> {
                        Intent intent = new Intent(Intent.ACTION_WEB_SEARCH);
                        intent.putExtra(SearchManager.QUERY, data);
                        startActivity(intent);
                    });
                    break;
                    
                case "open_url":
                    addActionButton(actionRow, "open link", dp, () -> {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(data));
                        startActivity(intent);
                    });
                    break;
                    
                case "open_app":
                    addActionButton(actionRow, "open " + data, dp, () -> {
                        openApp(data);
                    });
                    break;
                    
                case "set_alarm":
                    try {
                        JSONObject alarmData = new JSONObject(data);
                        int hour = alarmData.optInt("hour", 8);
                        int minute = alarmData.optInt("minute", 0);
                        String message = alarmData.optString("message", "alarm");
                        addActionButton(actionRow, "set alarm " + hour + ":" + String.format(Locale.US, "%02d", minute), dp, () -> {
                            Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
                            intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
                            intent.putExtra(AlarmClock.EXTRA_MINUTES, minute);
                            intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
                            startActivity(intent);
                        });
                    } catch (Exception e) {
                        Log.w(TAG, "Invalid alarm data", e);
                    }
                    break;
                    
                case "set_timer":
                    try {
                        JSONObject timerData = new JSONObject(data);
                        int seconds = timerData.optInt("seconds", 60);
                        String message = timerData.optString("message", "timer");
                        addActionButton(actionRow, "set " + seconds + "s timer", dp, () -> {
                            Intent intent = new Intent(AlarmClock.ACTION_SET_TIMER);
                            intent.putExtra(AlarmClock.EXTRA_LENGTH, seconds);
                            intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
                            intent.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
                            startActivity(intent);
                        });
                    } catch (Exception e) {
                        Log.w(TAG, "Invalid timer data", e);
                    }
                    break;
                    
                case "call":
                    addActionButton(actionRow, "call " + data, dp, () -> {
                        Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + data));
                        startActivity(intent);
                    });
                    break;
                    
                case "send_text":
                    try {
                        JSONObject smsData = new JSONObject(data);
                        String number = smsData.optString("number", "");
                        String message = smsData.optString("message", "");
                        addActionButton(actionRow, "send text", dp, () -> {
                            Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + number));
                            intent.putExtra("sms_body", message);
                            startActivity(intent);
                        });
                    } catch (Exception e) {
                        Log.w(TAG, "Invalid SMS data", e);
                    }
                    break;
                    
                case "settings":
                    addActionButton(actionRow, "open settings", dp, () -> {
                        openSettings(data);
                    });
                    break;
                    
                case "none":
                default:
                    break;
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse action", e);
        }
    }
    
    private void addActionButton(LinearLayout parent, String label, float dp, Runnable action) {
        TextView btn = new TextView(this);
        btn.setText(label.toLowerCase(Locale.ROOT));
        btn.setTextColor(0xFF050505);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        btn.setPadding((int)(16*dp), (int)(10*dp), (int)(16*dp), (int)(10*dp));
        
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFFF5AF12);
        bg.setCornerRadius(8*dp);
        btn.setBackground(bg);
        
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lp.setMarginEnd((int)(8*dp));
        btn.setLayoutParams(lp);
        
        btn.setOnClickListener(v -> {
            try {
                action.run();
                // Dismiss after executing action with a delay
                mainHandler.postDelayed(() -> finish(), 500);
            } catch (Exception e) {
                Log.e(TAG, "Action failed", e);
            }
        });
        
        parent.addView(btn);
    }
    
    private void openApp(String appNameOrPackage) {
        // Try as package name first
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(appNameOrPackage);
        if (launchIntent != null) {
            startActivity(launchIntent);
            return;
        }
        
        // Try common app name mappings
        String pkg = resolveAppName(appNameOrPackage.toLowerCase(Locale.ROOT));
        if (pkg != null) {
            launchIntent = getPackageManager().getLaunchIntentForPackage(pkg);
            if (launchIntent != null) {
                startActivity(launchIntent);
                return;
            }
        }
        
        // Fall back to Play Store search
        try {
            Intent playIntent = new Intent(Intent.ACTION_VIEW,
                Uri.parse("market://search?q=" + appNameOrPackage));
            startActivity(playIntent);
        } catch (ActivityNotFoundException e) {
            Intent webIntent = new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://play.google.com/store/search?q=" + appNameOrPackage));
            startActivity(webIntent);
        }
    }
    
    private String resolveAppName(String name) {
        switch (name) {
            case "camera": return "com.google.android.GoogleCamera";
            case "photos": case "gallery": return "com.google.android.apps.photos";
            case "maps": return "com.google.android.apps.maps";
            case "youtube": return "com.google.android.youtube";
            case "chrome": return "com.android.chrome";
            case "gmail": case "email": return "com.google.android.gm";
            case "messages": case "sms": return "com.google.android.apps.messaging";
            case "phone": case "dialer": return "com.google.android.dialer";
            case "calendar": return "com.google.android.calendar";
            case "clock": case "alarm": return "com.google.android.deskclock";
            case "calculator": return "com.google.android.calculator";
            case "files": return "com.google.android.documentsui";
            case "settings": return "com.android.settings";
            case "spotify": return "com.spotify.music";
            case "whatsapp": return "com.whatsapp";
            case "instagram": return "com.instagram.android";
            case "twitter": case "x": return "com.twitter.android";
            case "telegram": return "org.telegram.messenger";
            case "discord": return "com.discord";
            case "reddit": return "com.reddit.frontpage";
            case "tiktok": return "com.zhiliaoapp.musically";
            case "netflix": return "com.netflix.mediaclient";
            default: return null;
        }
    }
    
    private void openSettings(String settingName) {
        Intent intent;
        switch (settingName.toLowerCase(Locale.ROOT)) {
            case "wifi": case "wi-fi":
                intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
                break;
            case "bluetooth":
                intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
                break;
            case "display": case "brightness":
                intent = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
                break;
            case "sound": case "volume":
                intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
                break;
            case "battery":
                intent = new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS);
                break;
            case "location": case "gps":
                intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                break;
            case "apps": case "applications":
                intent = new Intent(Settings.ACTION_APPLICATION_SETTINGS);
                break;
            case "notification": case "notifications":
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                break;
            default:
                intent = new Intent(Settings.ACTION_SETTINGS);
                break;
        }
        startActivity(intent);
    }
    
    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (executor != null) {
            executor.shutdown();
        }
    }
}
