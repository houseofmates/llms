package com.example.llms;

import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LlamaServerService extends Service {
    private static final String TAG = "LlamaServer";
    private static final String CHANNEL_ID = "llama_server_channel";
    private static final int NOTIFICATION_ID = 1;
    private static final String PREFS_NAME = "llama_prefs";
    private static final String PREF_DOWNLOAD_ID = "download_id";
    private static final String[] NATIVE_SERVER_BINARY_NAMES = {
        "libllama_server.so",
        "lib_llama_server.so"
    };
    private static final String[] LEGACY_SERVER_BINARY_NAMES = {
        "llama",
        "llama-server"
    };
    
 // Model download URL - Gemma 4 4B IT OBLITERATED Q4_K_M
 private static final String MODEL_URL = "https://huggingface.co/OBLITERATUS/gemma-4-E4B-it-OBLITERATED/resolve/main/gemma-4-E4B-it-OBLITERATED-Q4_K_M.gguf";
 private static final String MODEL_NAME = "gemma-4-e4b-q4.gguf";
    private static final long MODEL_SIZE_MIN = 2500000000L; // ~2.5GB minimum
    private static final long MODEL_SIZE_EXPECTED = 2900000000L; // ~2.9GB expected
    private static final long MODEL_SIZE_MAX_DELTA = 200000000L; // 200MB tolerance
    
    private Process serverProcess;
    private ExecutorService executor;
    private final IBinder binder = new LocalBinder();
    private volatile boolean isRunning = false;
    private volatile boolean isModelReady = false;
    private volatile boolean isDownloading = false;
    private volatile int downloadProgress = 0;
    private volatile String lastError = null;
    private PowerManager.WakeLock wakeLock;
    private Handler mainHandler;
    
    // Callback interface for status updates
    public interface ServerCallback {
        void onStatusUpdate(String status, int progress);
        void onServerStarted();
        void onServerStopped(String error);
        void onModelDownloadProgress(int progress, long downloaded, long total);
    }
    
    private ServerCallback callback;
    
    public class LocalBinder extends Binder {
        LlamaServerService getService() {
            return LlamaServerService.this;
        }
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadExecutor();
        mainHandler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
        
        // Check if model already exists
        File modelFile = new File(getModelDirectory(), MODEL_NAME);
        if (modelFile.exists() && isModelFileComplete(modelFile)) {
            isModelReady = true;
            Log.d(TAG, "Model already present: " + modelFile.length() + " bytes");
        } else if (modelFile.exists()) {
            Log.w(TAG, "Model file incomplete (" + modelFile.length() + " bytes), will re-download");
            lastError = "model incomplete - " + (modelFile.length()/(1024*1024)) + "MB downloaded, need ~2900MB";
        }
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "=== LlamaServerService onStartCommand ===");
        
        // Start as foreground service immediately
        startForeground(NOTIFICATION_ID, createNotification("LLM service ready"));
        
        // Check model status on startup
        File modelFile = new File(getModelDirectory(), MODEL_NAME);
        Log.d(TAG, "Model path: " + modelFile.getAbsolutePath());
        Log.d(TAG, "Model exists: " + modelFile.exists());
        Log.d(TAG, "Model size: " + modelFile.length());
        
        if (modelFile.exists() && isModelFileComplete(modelFile)) {
            isModelReady = true;
            updateNotification("Model ready. Tap to start server.");
            Log.d(TAG, "Model is ready");
        } else if (modelFile.exists()) {
            lastError = "model incomplete - download was interrupted";
            Log.w(TAG, "Model file incomplete at startup: " + modelFile.length() + " bytes");
            
            // Try to start server automatically
            executor.execute(() -> tryStartServer());
        } else {
            updateNotification("Model not downloaded. Open app to download.");
            Log.d(TAG, "Model not found - waiting for user to trigger download");
        }
        
        return START_STICKY;
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "LLM Server",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Local LLM model download and inference server (Gemma 4)");
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }
    
    private Notification createNotification(String text) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent, 
            PendingIntent.FLAG_IMMUTABLE
        );
        
        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("llms - local ai")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build();
    }
    
    private void updateNotification(String text) {
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.notify(NOTIFICATION_ID, createNotification(text));
        } catch (Exception e) {
            Log.w(TAG, "Failed to update notification: " + e.getMessage());
        }
    }

    private File findNativeServerBinary() {
        String nativeLibDir = getApplicationInfo().nativeLibraryDir;
        Log.d(TAG, "Searching for native binary in: " + nativeLibDir);

        // Try known binary names first
        for (String binaryName : NATIVE_SERVER_BINARY_NAMES) {
            File nativeBinary = new File(nativeLibDir, binaryName);
            Log.d(TAG, "Checking: " + nativeBinary.getAbsolutePath() +
                " exists=" + nativeBinary.exists() + " size=" + nativeBinary.length());
            if (nativeBinary.exists() && nativeBinary.length() > 1000000) {
                Log.d(TAG, "Using native library binary: " + nativeBinary.getAbsolutePath());
                return nativeBinary;
            }
        }

        // Fallback: scan all .so files in nativeLibraryDir for anything large enough to be llama-server
        File nativeLibDirFile = new File(nativeLibDir);
        if (nativeLibDirFile.exists() && nativeLibDirFile.isDirectory()) {
            File[] files = nativeLibDirFile.listFiles();
            if (files != null) {
                for (File f : files) {
                    if (f.getName().startsWith("lib") && f.getName().endsWith(".so") && f.length() > 10000000) {
                        Log.d(TAG, "Found large native binary by scan: " + f.getAbsolutePath() + " size=" + f.length());
                        return f;
                    }
                }
            }
        }

        Log.w(TAG, "No native library binary found in: " + nativeLibDir);
        return null;
    }
    
    private File extractAssetStandalone() {
        try {
            // Try to extract to /data/local/tmp first (most reliable for execution)
            File tmpDir = new File("/data/local/tmp/llms-" + getPackageName());
            if (!tmpDir.exists()) {
                tmpDir.mkdirs();
            }
            
            File cacheBin = new File(tmpDir, "llama-server");
            Log.d(TAG, "Extracting standalone llama-server to: " + cacheBin.getAbsolutePath());
            
            java.io.InputStream is = getAssets().open("bin/llama-server");
            java.io.FileOutputStream fos = new java.io.FileOutputStream(cacheBin);
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = is.read(buffer)) != -1) {
                fos.write(buffer, 0, bytesRead);
            }
            is.close();
            fos.close();
            
            // Set permissions
            cacheBin.setExecutable(true, false);
            cacheBin.setReadable(true, false);
            
            // Also try chmod via shell
            try {
                Runtime.getRuntime().exec("chmod 755 " + cacheBin.getAbsolutePath()).waitFor();
            } catch (Exception e) {}
            
            Log.d(TAG, "Extracted to: " + cacheBin.getAbsolutePath() + 
                  " size=" + cacheBin.length() + " exec=" + cacheBin.canExecute());
            
            return cacheBin;
        } catch (Exception e) {
            Log.e(TAG, "Failed to extract standalone: " + e.getMessage());
            return null;
        }
    }

    private void cleanupLegacyServerBinaries() {
        File binDir = new File(getFilesDir(), "bin");
        if (binDir.exists()) {
            for (String binaryName : LEGACY_SERVER_BINARY_NAMES) {
                File legacyBinary = new File(binDir, binaryName);
                if (legacyBinary.exists()) {
                    Log.d(TAG, "Removing legacy binary: " + legacyBinary.getAbsolutePath());
                    if (legacyBinary.delete()) {
                        Log.d(TAG, "Removed legacy server binary: " + legacyBinary.getAbsolutePath());
                    }
                }
            }
            // Also list what's in the directory for debugging
            File[] files = binDir.listFiles();
            if (files != null && files.length > 0) {
                for (File f : files) {
                    Log.d(TAG, "Remaining in binDir: " + f.getName() + " size=" + f.length());
                }
            }
        }
        File[] cacheFiles = {
            new File(getCacheDir(), "llama-server"),
            new File(getCacheDir(), "run-server.sh"),
            new File(getCacheDir(), "server.log")
        };
        for (File cacheFile : cacheFiles) {
            if (cacheFile.exists() && cacheFile.delete()) {
                Log.d(TAG, "Removed cache launcher file: " + cacheFile.getAbsolutePath());
            }
        }
    }
    
    private File extractServerBinary() {
        cleanupLegacyServerBinaries();

        File nativeBinary = findNativeServerBinary();
        if (nativeBinary != null) {
            return nativeBinary;
        }

        // Fallback: try to extract to /data/local/tmp/ where exec is allowed
        File tmpBinary = extractToTmpDir();
        if (tmpBinary != null) {
            return tmpBinary;
        }

        // On Android 10+, we CAN use files/bin/ as a fallback because
        // startDirectly() and startViaShell() use linker64 to load the binary,
        // which bypasses W^X policy (linker64 is in /system/bin, an executable location)
        File filesBinary = extractToFilesDir();
        if (filesBinary != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                Log.d(TAG, "Using files/bin binary with linker64 workaround for Android 10+ W^X");
            }
            return filesBinary;
        }

        // If all methods failed, return null so caller knows
        lastError = "Could not find executable llama-server binary. Tried: native lib, /data/local/tmp/, files dir";
        Log.e(TAG, lastError);
        return null;
    }
    
    private File extractToTmpDir() {
        try {
            File tmpDir = new File("/data/local/tmp/llms-" + getPackageName());
            if (!tmpDir.exists()) {
                // May need root to create, but try anyway
                tmpDir.mkdirs();
            }
            
            File serverBinary = new File(tmpDir, "llama-server");
            
            // Copy from assets if needed
            if (!serverBinary.exists() || serverBinary.length() < 1000000) {
                java.io.InputStream is = getAssets().open("bin/llama-server");
                java.io.FileOutputStream fos = new java.io.FileOutputStream(serverBinary);
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = is.read(buffer)) != -1) {
                    fos.write(buffer, 0, bytesRead);
                }
                is.close();
                fos.close();
                
                // Set permissions: world readable + executable
                serverBinary.setReadable(true, false);
                serverBinary.setExecutable(true, false);
                
                // Try chmod 755 via shell
                try {
                    Runtime.getRuntime().exec("/system/bin/chmod 755 " + serverBinary.getAbsolutePath());
                } catch (Exception ignored) {}
            }
            
            if (serverBinary.exists() && serverBinary.canExecute()) {
                Log.d(TAG, "Using /data/local/tmp binary: " + serverBinary.getAbsolutePath());
                return serverBinary;
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to extract to /data/local/tmp: " + e.getMessage());
        }
        return null;
    }
    
    private File extractToFilesDir() {
        // The llama-server binary is in assets/bin/llama-server
        // We need to copy it to a writable location and make it executable
        // On Android 10+, direct execution from here fails with exit 126 (W^X policy)
        // but we use linker64 as a workaround in startDirectly/startViaShell
        File binDir = new File(getFilesDir(), "bin");
        if (!binDir.exists()) binDir.mkdirs();

        // remove older filenames so we do not accidentally reuse a stale non-executable binary
        File legacyBinary = new File(binDir, "llama");
        if (legacyBinary.exists()) {
            legacyBinary.delete();
        }

        File serverBinary = new File(binDir, "llama-server");

        // Check if we already have the binary - but verify it's actually usable
        if (serverBinary.exists() && serverBinary.length() > 10000000) {
            Log.d(TAG, "Found existing binary: " + serverBinary.getAbsolutePath() +
                " size=" + serverBinary.length() + " canExec=" + serverBinary.canExecute());
            // Even if canExecute returns false, linker64 can still load it
            return serverBinary;
        }

        // Try to copy from assets
        try {
            java.io.InputStream is = getAssets().open("bin/llama-server");
            java.io.FileOutputStream fos = new java.io.FileOutputStream(serverBinary);
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = is.read(buffer)) != -1) {
                fos.write(buffer, 0, bytesRead);
            }
            is.close();
            fos.close();

            // Set execute permission (may not work on Android 10+ but linker64 bypasses this)
            serverBinary.setExecutable(true);

            Log.d(TAG, "Extracted llama-server to: " + serverBinary.getAbsolutePath());
            Log.d(TAG, "Size: " + serverBinary.length() + " canExec=" + serverBinary.canExecute());

            return serverBinary;

        } catch (Exception e) {
            Log.e(TAG, "Failed to extract llama-server from assets: " + e.getMessage(), e);
            lastError = "llama-server binary not found: " + e.getMessage();
            Log.e(TAG, lastError);
            return null;
        }
    }
    
    // Public method to manually trigger download (called from JavaScript via AndroidBridge)
    public void startManualDownload() {
        Log.d(TAG, "=== Manual download requested ===");
        
        if (isDownloading) {
            Log.w(TAG, "Download already in progress");
            return;
        }
        
        if (isModelReady) {
            Log.d(TAG, "Model already downloaded");
            return;
        }
        
        isDownloading = true;
        downloadProgress = 0;
        lastError = null;
        
        // Acquire wake lock for download duration (4 hours max)
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (wakeLock == null || !wakeLock.isHeld()) {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LlamaServer::DownloadLock");
                wakeLock.acquire(4 * 60 * 60 * 1000L);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire wake lock", e);
        }
        
        executor.execute(() -> {
            File modelDir = getModelDirectory();
            File modelFile = new File(modelDir, MODEL_NAME);
            
            updateNotification("Starting model download...");
            notifyStatus("downloading_model", 0);
            
            downloadModelDirect(modelFile);
            
            if (isModelReady && !isRunning) {
                tryStartServer();
            }
            
            isDownloading = false;
            
            // Release wake lock
            try {
                if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            } catch (Exception e) {
                Log.w(TAG, "Failed to release wake lock", e);
            }
        });
    }
    
    private void downloadModelDirect(File modelFile) {
        Log.d(TAG, "=== Starting direct HTTP download ===");
        Log.d(TAG, "URL: " + MODEL_URL);
        Log.d(TAG, "Target: " + modelFile.getAbsolutePath());
        Log.d(TAG, "Free space: " + modelFile.getParentFile().getFreeSpace() / (1024*1024) + " MB");
        
        // Check free space
 long freeSpace = modelFile.getParentFile().getFreeSpace();
 if (freeSpace < 4000000000L) {
 lastError = "not enough storage. need ~4gb free, have " + (freeSpace/(1024*1024)) + "mb";
            Log.e(TAG, lastError);
            updateNotification("download failed: not enough space");
            notifyError(lastError);
            return;
        }
        
        // Support resume
        long existingSize = 0;
        if (modelFile.exists()) {
            existingSize = modelFile.length();
            if (existingSize > MODEL_SIZE_MIN) {
                isModelReady = true;
                updateNotification("model ready!");
                notifyStatus("model_ready", 100);
                return;
            }
            Log.d(TAG, "resuming from " + existingSize + " bytes (" + (existingSize/(1024*1024)) + " MB)");
        }
        
        // Download with retry logic
        int maxRetries = 3;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            Log.d(TAG, "download attempt " + attempt + "/" + maxRetries);
            boolean success = attemptDownload(modelFile, existingSize, attempt);
            if (success) {
                return;
            }
            
            // Check if we made progress
            long currentSize = modelFile.exists() ? modelFile.length() : 0;
            if (currentSize > existingSize) {
                existingSize = currentSize; // Resume from new position
                Log.d(TAG, "will resume from " + existingSize + " on next attempt");
            }
            
            if (attempt < maxRetries) {
                Log.d(TAG, "retrying in 3 seconds...");
                try { Thread.sleep(3000); } catch (InterruptedException e) { break; }
            }
        }
        
        // All retries failed
        Log.e(TAG, "all download attempts failed");
        if (lastError == null) {
            lastError = "download failed after " + maxRetries + " attempts";
        }
        updateNotification("download failed: " + lastError);
        notifyError(lastError);
    }
    
    private boolean attemptDownload(File modelFile, long resumeFrom, int attemptNum) {
        HttpURLConnection connection = null;
        InputStream input = null;
        FileOutputStream output = null;
        
        try {
            // Follow redirects manually for HuggingFace CDN
            String downloadUrl = MODEL_URL;
            int maxRedirects = 5;
            
            for (int i = 0; i < maxRedirects; i++) {
                URL url = new URL(downloadUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(15000);
                connection.setInstanceFollowRedirects(false);
                
                if (resumeFrom > 0) {
                    connection.setRequestProperty("Range", "bytes=" + resumeFrom + "-");
                    Log.d(TAG, "requesting resume from byte " + resumeFrom);
                }
                
                int code = connection.getResponseCode();
                Log.d(TAG, "HTTP " + code + " from " + downloadUrl);
                
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    downloadUrl = connection.getHeaderField("Location");
                    Log.d(TAG, "redirect -> " + downloadUrl);
                    connection.disconnect();
                    continue;
                }
                
                if (code == 200 || code == 206) {
                    break;
                }
                
                String errorBody = "";
                try {
                    InputStream errorStream = connection.getErrorStream();
                    if (errorStream != null) {
                        BufferedReader reader = new BufferedReader(new InputStreamReader(errorStream));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) sb.append(line);
                        errorBody = sb.toString().substring(0, Math.min(200, sb.length()));
                    }
                } catch (Exception ignored) {}
                
                throw new IOException("HTTP " + code + ": " + errorBody);
            }
            
            long contentLength = connection.getContentLengthLong();
            int responseCode = connection.getResponseCode();
            boolean isResume = responseCode == 206;
            
            long totalSize;
            if (isResume && contentLength > 0) {
                totalSize = contentLength + resumeFrom;
            } else {
                resumeFrom = 0;
                if (contentLength > 0) {
                    totalSize = contentLength;
                } else {
                    totalSize = 2900000000L; // ~2.9GB for Gemma 4 4B Q4_K_M
                }
            }
            
            Log.d(TAG, "total expected: " + totalSize + " bytes (" + (totalSize/(1024*1024)) + " MB), resume=" + isResume);
            updateNotification("downloading: 0% (attempt " + attemptNum + ")");
            
            input = connection.getInputStream();
            output = new FileOutputStream(modelFile, isResume);
            
            byte[] buffer = new byte[65536]; // 64KB buffer
            long downloaded = resumeFrom;
            int lastPercent = 0;
            long lastNotifyTime = System.currentTimeMillis();
            long lastBytesTime = System.currentTimeMillis();
            long startTime = System.currentTimeMillis();
            long bytesSinceLastCheck = 0;
            int bytesRead;

            Log.d(TAG, "download loop starting...");

            while (true) {
                // Read with timeout detection
                bytesRead = input.read(buffer);
                if (bytesRead == -1) break;
                
                output.write(buffer, 0, bytesRead);
                downloaded += bytesRead;
                bytesSinceLastCheck += bytesRead;
                
                long now = System.currentTimeMillis();
                
                // Check for stalled download (2 minute timeout for slow connections)
                long stallTimeout = 120000; // 2 minutes
                // Be more lenient near the end (last 5%)
                if (downloaded > (totalSize * 95 / 100)) {
                    stallTimeout = 600000; // 10 minutes for final bytes - they can be very slow
                }
                // At 98%+, check more frequently if we might be done
                int currentPercent = (int) ((downloaded * 100) / totalSize);
                if (currentPercent >= 98) {
                    // Force flush more aggressively near the end
                    if (now - lastNotifyTime > 5000) {
                        try {
                            output.flush();
                            output.getFD().sync(); // Force sync to disk
                        } catch (Exception ignored) {}
                        // Check if file size matches expected (within 1MB tolerance)
                        long currentFileSize = modelFile.length();
                        if (currentFileSize >= totalSize - 1000000) {
                            Log.d(TAG, "File appears complete at " + currentPercent + "%, size=" + currentFileSize);
                            break; // Exit loop - file is complete enough
                        }
                    }
                }
                if (now - lastBytesTime > stallTimeout) {
                    if (bytesSinceLastCheck < 1024) {
                        Log.w(TAG, "download stalled! no significant progress in " + (stallTimeout/1000) + " seconds");
                        lastError = "download stalled - connection timed out";
                        throw new IOException("download stalled");
                    }
                    lastBytesTime = now;
                    bytesSinceLastCheck = 0;
                }
                
                int percent = (int) ((downloaded * 100) / totalSize);
                downloadProgress = percent;
                
                // Update every 2 seconds or every 2%
                if (percent != lastPercent || (now - lastNotifyTime > 2000)) {
                    lastPercent = percent;
                    lastNotifyTime = now;
                    
                    long elapsed = now - startTime;
                    long speed = elapsed > 0 ? ((downloaded - resumeFrom) * 1000 / elapsed) : 0;
                    String speedStr = speed > 1024*1024 ? (speed/(1024*1024)) + " MB/s" : (speed/1024) + " KB/s";
                    
                    String msg = "downloading: " + percent + "% (" + (downloaded/(1024*1024)) + "/" + (totalSize/(1024*1024)) + " MB) " + speedStr;
                    updateNotification(msg);
                    notifyDownloadProgress(percent, downloaded, totalSize);
                    
                    if (percent % 5 == 0) {
                        Log.d(TAG, msg);
                    }
                }
            }
            
            output.flush();
            output.close();
            output = null;
            input.close();
            input = null;
            
            long finalSize = modelFile.length();
            Log.d(TAG, "=== download complete ===");
            Log.d(TAG, "final size: " + finalSize + " bytes (" + (finalSize/(1024*1024)) + " MB)");
            
            if (finalSize < MODEL_SIZE_MIN) {
                lastError = "download incomplete: " + (finalSize/(1024*1024)) + "mb (expected ~2.9GB)";
                Log.e(TAG, lastError);
                return false;
            }
            
            isModelReady = true;
            downloadProgress = 100;
            updateNotification("model downloaded! starting server...");
            notifyStatus("model_ready", 100);
            Log.d(TAG, "model download SUCCESS");
            return true;
            
        } catch (Exception e) {
            lastError = e.getMessage();
            Log.e(TAG, "download attempt " + attemptNum + " failed: " + lastError, e);
            return false;
        } finally {
            try { if (output != null) output.close(); } catch (Exception ignored) {}
            try { if (input != null) input.close(); } catch (Exception ignored) {}
            try { if (connection != null) connection.disconnect(); } catch (Exception ignored) {}
        }
    }
    
    // Check if model is complete (within tolerance of expected size)
    private boolean isModelFileComplete(File modelFile) {
        long size = modelFile.length();
        // Must be at least minimum
        if (size < MODEL_SIZE_MIN) return false;
        // Must be within tolerance of expected (not just "above minimum")
        long delta = Math.abs(size - MODEL_SIZE_EXPECTED);
        if (delta > MODEL_SIZE_MAX_DELTA) {
            Log.w(TAG, "Model file incomplete: " + size + " bytes, expected " + MODEL_SIZE_EXPECTED + " +/- " + MODEL_SIZE_MAX_DELTA);
            return false;
        }
        return true;
    }
    
    private void tryStartServer() {
        if (isRunning) {
            Log.d(TAG, "Server already running");
            return;
        }
        
        File modelFile = new File(getModelDirectory(), MODEL_NAME);
        Log.d(TAG, "tryStartServer: model file exists=" + modelFile.exists() + " size=" + modelFile.length());
        
        if (!modelFile.exists() || modelFile.length() < MODEL_SIZE_MIN) {
            Log.d(TAG, "Cannot start server: model not ready");
            return;
        }
        
        File serverBinary = extractServerBinary();
        if (serverBinary == null) {
            Log.e(TAG, "Cannot start server: binary extraction failed");
            updateNotification("Model ready but server binary failed to extract");
            return;
        }
        
        Log.d(TAG, "Starting llama server with binary: " + serverBinary.getAbsolutePath());
        startLlamaServer(serverBinary, modelFile);
    }
    
    private void startLlamaServer(File serverBinary, File modelFile) {
        try {
            notifyStatus("starting_server", 0);
            updateNotification("Starting LLM server...");
            lastError = null;

            Log.d(TAG, "Starting llama server with binary: " + serverBinary.getAbsolutePath());

            // Always try startDirectly first - it handles linker64 workaround for W^X
            startDirectly(serverBinary, modelFile);

        } catch (Exception e) {
            Log.e(TAG, "Failed to start server", e);
            isRunning = false;
            lastError = e.getMessage();
            notifyError("Server error: " + e.getMessage());
        }
    }

    private String findLinker64() {
        String[] linkerPaths = {"/system/bin/linker64", "/system/bin/linker", "/system/bin/app_process64"};
        for (String path : linkerPaths) {
            if (new File(path).exists()) {
                return path;
            }
        }
        return null;
    }

    private void startDirectly(File serverBinary, File modelFile) {
        try {
            String nativeLibDir = getApplicationInfo().nativeLibraryDir;
            boolean inNativeLibDir = serverBinary.getAbsolutePath().startsWith(nativeLibDir);

            String executable;
            String[] args;

            int threads = Math.min(4, Runtime.getRuntime().availableProcessors());

            if (inNativeLibDir) {
                // Binary is in nativeLibraryDir - can execute directly
                executable = serverBinary.getAbsolutePath();
                args = new String[]{
                    serverBinary.getAbsolutePath(),
                    "-m", modelFile.getAbsolutePath(),
                    "--port", "5053",
                    "--host", "127.0.0.1",
                    "-c", "8192",
                    "-n", "2048",
                    "--threads", String.valueOf(threads),
                    "--batch-size", "512"
                };
            } else {
                // Binary is NOT in nativeLibraryDir (e.g., files/bin/ or /data/local/tmp/)
                // On Android 10+, direct execution from these dirs fails with exit 126 (W^X policy)
                // Use linker64 to load the binary - linker64 is in /system/bin which is always executable
                String linkerPath = findLinker64();
                if (linkerPath == null) {
                    Log.w(TAG, "No linker64 found, falling back to shell method");
                    startViaShell(serverBinary, modelFile);
                    return;
                }

                Log.d(TAG, "Using linker64 workaround for W^X: " + linkerPath + " " + serverBinary.getAbsolutePath());
                executable = linkerPath;
                args = new String[]{
                    linkerPath,
                    serverBinary.getAbsolutePath(),
                    "-m", modelFile.getAbsolutePath(),
                    "--port", "5053",
                    "--host", "127.0.0.1",
                    "-c", "8192",
                    "-n", "2048",
                    "--threads", String.valueOf(threads),
                    "--batch-size", "512"
                };
            }

            ProcessBuilder pb = new ProcessBuilder(args);

            // Set library path for native dependencies (libllama.so, libggml*.so, etc.)
            Map<String, String> env = pb.environment();
            env.put("LD_LIBRARY_PATH", nativeLibDir);

            pb.redirectErrorStream(true);
            pb.directory(getFilesDir());

            serverProcess = pb.start();
            isRunning = true;

            monitorServerProcess();

        } catch (Exception e) {
            Log.e(TAG, "Direct execution failed", e);
            // Fallback to shell method
            startViaShell(serverBinary, modelFile);
        }
    }
    
    private void startViaShell(File serverBinary, File modelFile) {
        try {
            Log.d(TAG, "Starting server via shell wrapper...");

            String binaryPath = serverBinary.getAbsolutePath();
            String nativeLibDir = getApplicationInfo().nativeLibraryDir;
            boolean inNativeLibDir = binaryPath.startsWith(nativeLibDir);
            int threads = Math.min(4, Runtime.getRuntime().availableProcessors());

            // Create shell script with linker64 workaround for W^X policy
            File scriptFile = new File(getCacheDir(), "run-server.sh");
            StringBuilder script = new StringBuilder();
            script.append("#!/system/bin/sh\n");
            script.append("BIN=\"").append(binaryPath).append("\"\n");
            script.append("MODEL=\"").append(modelFile.getAbsolutePath()).append("\"\n");
            script.append("NATIVE_LIB=\"").append(nativeLibDir).append("\"\n");
            script.append("LOG=/data/data/").append(getPackageName()).append("/cache/server.log\n");
            script.append("THREADS=").append(threads).append("\n");
            script.append("echo \"Starting at $(date)\" > $LOG\n");
            script.append("echo \"BIN=$BIN\" >> $LOG\n");
            script.append("echo \"NATIVE_LIB=$NATIVE_LIB\" >> $LOG\n");
            script.append("ls -la $BIN >> $LOG 2>&1\n");
            script.append("export LD_LIBRARY_PATH=$NATIVE_LIB:$LD_LIBRARY_PATH\n");

            if (inNativeLibDir) {
                // Binary is in nativeLibraryDir - direct execution should work
                script.append("echo \"Direct execution (native lib dir)...\" >> $LOG\n");
                script.append("chmod 755 $BIN 2>/dev/null || true\n");
                script.append("$BIN -m $MODEL --port 5053 --host 127.0.0.1 -c 4096 -n 512 --threads $THREADS --batch-size 512 >> $LOG 2>&1 &\n");
            } else {
                // Binary is in app data dir or /data/local/tmp/
                // On Android 10+, direct execution fails with exit 126 due to W^X policy
                // Use linker64 to load the binary - this bypasses W^X because linker64
                // is in /system/bin which is always in an executable location
                script.append("LINKER64=/system/bin/linker64\n");
                script.append("if [ ! -x $LINKER64 ]; then\n");
                script.append("  LINKER64=/system/bin/linker\n");
                script.append("fi\n");
                script.append("echo \"Using linker64 workaround for W^X...\" >> $LOG\n");
                script.append("echo \"LINKER64=$LINKER64\" >> $LOG\n");
                script.append("chmod 755 $BIN 2>/dev/null || true\n");
                // Method 1: Use linker64 to load the binary (bypasses W^X)
                script.append("if [ -x $LINKER64 ]; then\n");
                script.append("  echo \"Starting via linker64...\" >> $LOG\n");
                script.append("  $LINKER64 $BIN -m $MODEL --port 5053 --host 127.0.0.1 -c 4096 -n 512 --threads $THREADS --batch-size 512 >> $LOG 2>&1 &\n");
                script.append("else\n");
                // Method 2: Fallback to direct execution (only works on Android < 10 or in native lib dir)
                script.append("  echo \"No linker64, trying direct execution...\" >> $LOG\n");
                script.append("  $BIN -m $MODEL --port 5053 --host 127.0.0.1 -c 4096 -n 512 --threads $THREADS --batch-size 512 >> $LOG 2>&1 &\n");
                script.append("fi\n");
            }

            script.append("PID=$!\n");
            script.append("echo \"Started PID=$PID\" >> $LOG\n");
            script.append("sleep 5\n");
            script.append("if kill -0 $PID 2>/dev/null; then\n");
            script.append("  echo \"Server running with PID=$PID\" >> $LOG\n");
            script.append("  exit 0\n");
            script.append("fi\n");
            script.append("echo \"Server failed to start, check $LOG for errors\" >> $LOG\n");
            script.append("cat $LOG >> /dev/stderr\n");
            script.append("exit 1\n");

            java.nio.file.Files.write(scriptFile.toPath(), script.toString().getBytes());
            scriptFile.setExecutable(true, false);

            Log.d(TAG, "Script content:\n" + script.toString());
            Log.d(TAG, "Script path: " + scriptFile.getAbsolutePath());

            ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", scriptFile.getAbsolutePath());
            pb.redirectErrorStream(true);
            pb.directory(getFilesDir());

            serverProcess = pb.start();
            isRunning = true;

            monitorServerProcess();

        } catch (Exception e) {
            Log.e(TAG, "Shell execution also failed", e);
            isRunning = false;
            lastError = "Cannot execute binary: " + e.getMessage();
            notifyError(lastError);
        }
    }
    
    private void monitorServerProcess() {
        executor.execute(() -> {
            try {
                BufferedReader reader = new BufferedReader(
                    new InputStreamReader(serverProcess.getInputStream())
                );
                String line;
                boolean serverReady = false;
                StringBuilder errorOutput = new StringBuilder();
                
                while ((line = reader.readLine()) != null) {
                    Log.d(TAG, "Server: " + line);
                    
                    // Keep the most recent output so startup errors don't get buried by launcher noise.
                    errorOutput.append(line).append("\n");
                    if (errorOutput.length() > 4000) {
                        errorOutput.delete(0, errorOutput.length() - 4000);
                    }
                    
                    // Check for any indication of server being ready
                    if (line.contains("HTTP server listening") || 
                        line.contains("listening on") ||
                        line.contains("port 5053") ||
                        line.contains("server ready") ||
                        line.contains("llama server running")) {
                        serverReady = true;
                        notifyServerStarted();
                        updateNotification("LLM server running on port 5053");
                    }
                }
                
                // After process ends, also check if port 5053 is now listening
                int exitCode = serverProcess.waitFor();
                Log.d(TAG, "Server process ended with: " + exitCode);
                
                // Double-check the server is actually running by checking the port
                if (!serverReady && isPortListening(5053)) {
                    Log.d(TAG, "Server ready detected via port check");
                    serverReady = true;
                    notifyServerStarted();
                    updateNotification("LLM server running on port 5053");
                }
                
                isRunning = false;
                if (!serverReady) {
                    String errorMsg = errorOutput.toString().trim();
                    if (errorMsg.length() > 800) {
                        errorMsg = "..." + errorMsg.substring(errorMsg.length() - 800);
                    }
                    lastError = "Server failed (exit " + exitCode + "): " + errorMsg;
                    Log.e(TAG, lastError);
                    notifyError(lastError);
                } else {
                    notifyServerStopped("Server stopped");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error monitoring server", e);
                isRunning = false;
            }
        });
    }
    
    private boolean isPortListening(int port) {
        try {
            java.net.InetAddress localhost = java.net.InetAddress.getByAddress("127.0.0.1", new byte[]{127, 0, 0, 1});
            java.net.Socket socket = new java.net.Socket();
            socket.connect(new java.net.InetSocketAddress(localhost, port), 1000);
            socket.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }
    
    private File getModelDirectory() {
        File dir = new File(getFilesDir(), "models");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }
    
    // Public status accessors
    public boolean isRunning() { return isRunning; }
    public boolean isModelReady() { return isModelReady; }
    public boolean isDownloading() { return isDownloading; }
    public String getLastError() { return lastError; }
    
    // Returns a string status for JavaScript bridge
    public String getStatus() {
        if (isRunning) return "running";
        if (isDownloading) return "downloading";
        if (lastError != null) return "error";
        if (isModelReady) return "model_ready";
        return "no_model";
    }
    
    public String getDetailedStatusJson() {
        File modelFile = new File(getModelDirectory(), MODEL_NAME);
        return "{" +
            "\"status\":\"" + getStatus() + "\"," +
            "\"serverRunning\":" + isRunning + "," +
            "\"modelReady\":" + isModelReady + "," +
            "\"downloading\":" + isDownloading + "," +
            "\"downloadProgress\":" + downloadProgress + "," +
            "\"modelExists\":" + modelFile.exists() + "," +
            "\"modelSize\":" + modelFile.length() + "," +
            "\"modelSizeMB\":" + (modelFile.length()/(1024*1024)) + "," +
            "\"freeSpaceMB\":" + (getModelDirectory().getFreeSpace()/(1024*1024)) + "," +
            "\"lastError\":" + (lastError != null ? "\"" + lastError.replace("\"", "'") + "\"" : "null") +
            "}";
    }
    
    // Callback helpers
    private void notifyStatus(String status, int progress) {
        if (callback != null) {
            mainHandler.post(() -> callback.onStatusUpdate(status, progress));
        }
    }
    
    private void notifyDownloadProgress(int progress, long downloaded, long total) {
        if (callback != null) {
            mainHandler.post(() -> callback.onModelDownloadProgress(progress, downloaded, total));
        }
    }
    
    private void notifyServerStarted() {
        if (callback != null) {
            mainHandler.post(() -> callback.onServerStarted());
        }
    }
    
    private void notifyServerStopped(String error) {
        if (callback != null) {
            mainHandler.post(() -> callback.onServerStopped(error));
        }
    }
    
    private void notifyError(String error) {
        if (callback != null) {
            mainHandler.post(() -> callback.onServerStopped(error));
        }
    }
    
    public void setCallback(ServerCallback callback) {
        this.callback = callback;
    }
    
    public void stopServer() {
        if (serverProcess != null && serverProcess.isAlive()) {
            serverProcess.destroy();
            try {
                if (!serverProcess.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
                    serverProcess.destroyForcibly();
                }
            } catch (InterruptedException e) {
                serverProcess.destroyForcibly();
            }
        }
        isRunning = false;
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        stopServer();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (executor != null) executor.shutdown();
    }
}
