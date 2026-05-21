package space.houseofmates.llms;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Llama Offline Plugin for Capacitor
 * Handles downloading GGUF models and local inference using llama.cpp
 */
@CapacitorPlugin(name = "LlamaOfflinePlugin")
public class LlamaOfflinePlugin extends Plugin {
    private static final String TAG = "LlamaOfflinePlugin";
    private static final String MODEL_DIR = "llama_models";
    private static final String MODEL_FILE_NAME = "model.gguf";
    private static final String MODEL_INFO_FILE = "model_info.json";
    
    private DownloadManager downloadManager;
    private long currentDownloadId = -1;
    private BroadcastReceiver downloadReceiver;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, LlamaInference> activeSessions = new HashMap<>();
    
    @Override
    public void load() {
        super.load();
        downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        setupDownloadReceiver();
    }
    
    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (downloadReceiver != null) {
            getContext().unregisterReceiver(downloadReceiver);
        }
        executor.shutdown();
        for (LlamaInference session : activeSessions.values()) {
            session.close();
        }
        activeSessions.clear();
    }
    
    private void setupDownloadReceiver() {
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (downloadId == currentDownloadId) {
                    handleDownloadComplete(downloadId);
                }
            }
        };
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().registerReceiver(downloadReceiver, 
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), 
                Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(downloadReceiver, 
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }
    }
    
    @PluginMethod
    public void downloadModel(PluginCall call) {
        String url = call.getString("url");
        String modelId = call.getString("modelId");
        long expectedSize = call.getLong("expectedSize", 0L);
        
        if (url == null || modelId == null) {
            call.reject("Missing required parameters: url and modelId");
            return;
        }
        
        // Check if model already exists
        File modelDir = getModelDirectory();
        File modelFile = new File(modelDir, MODEL_FILE_NAME);
        File infoFile = new File(modelDir, MODEL_INFO_FILE);
        
        if (modelFile.exists() && infoFile.exists()) {
            try {
                String content = readFile(infoFile);
                JSONObject info = new JSONObject(content);
                if (modelId.equals(info.optString("modelId"))) {
                    JSObject result = new JSObject();
                    result.put("success", true);
                    result.put("path", modelFile.getAbsolutePath());
                    result.put("alreadyExists", true);
                    call.resolve(result);
                    return;
                }
            } catch (Exception e) {
                Log.w(TAG, "Error reading existing model info", e);
            }
        }
        
        // Start new download
        try {
            // Clean up old download if exists
            if (currentDownloadId != -1) {
                downloadManager.remove(currentDownloadId);
            }
            
            // Delete old model files
            deleteRecursive(modelDir);
            modelDir.mkdirs();
            
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
 request.setTitle("Downloading " + modelId);
 request.setDescription("Gemma 4 AI Model");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setDestinationUri(Uri.fromFile(new File(modelDir, MODEL_FILE_NAME + ".download")));
            request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI | DownloadManager.Request.NETWORK_MOBILE);
            
            currentDownloadId = downloadManager.enqueue(request);
            
            // Save download info for progress tracking
            JSObject downloadInfo = new JSObject();
            downloadInfo.put("callId", call.getCallbackId());
            downloadInfo.put("modelId", modelId);
            downloadInfo.put("expectedSize", expectedSize);
            
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("downloadId", currentDownloadId);
            result.put("message", "Download started");
            call.resolve(result);
            
            // Monitor progress
            monitorDownloadProgress(currentDownloadId, call, modelId, expectedSize);
            
        } catch (Exception e) {
            call.reject("Failed to start download: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void checkModelStatus(PluginCall call) {
        File modelDir = getModelDirectory();
        File modelFile = new File(modelDir, MODEL_FILE_NAME);
        File infoFile = new File(modelDir, MODEL_INFO_FILE);
        
        JSObject result = new JSObject();
        result.put("downloaded", modelFile.exists() && infoFile.exists());
        
        if (modelFile.exists() && infoFile.exists()) {
            try {
                String content = readFile(infoFile);
                JSONObject info = new JSONObject(content);
                result.put("modelId", info.optString("modelId", "unknown"));
                result.put("size", modelFile.length());
                result.put("path", modelFile.getAbsolutePath());
            } catch (Exception e) {
                Log.w(TAG, "Error reading model info", e);
            }
        }
        
        // Check available storage
        long freeSpace = modelDir.getFreeSpace();
        result.put("freeSpace", freeSpace);
        result.put("freeSpaceGB", freeSpace / (1024 * 1024 * 1024));
        
        call.resolve(result);
    }
    
    @PluginMethod
    public void deleteModel(PluginCall call) {
        File modelDir = getModelDirectory();
        boolean success = deleteRecursive(modelDir);
        
        JSObject result = new JSObject();
        result.put("success", success);
        call.resolve(result);
    }
    
    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject result = new JSObject();
        
        // RAM info
        long totalRam = getTotalRAM();
        long freeRam = getFreeRAM();
        result.put("totalRAM", totalRam);
        result.put("totalRAMGB", totalRam / (1024 * 1024 * 1024));
        result.put("freeRAM", freeRam);
        result.put("freeRAMGB", freeRam / (1024 * 1024 * 1024));
        
        // Storage info
        File modelDir = getModelDirectory();
        long freeSpace = modelDir.getFreeSpace();
        long totalSpace = modelDir.getTotalSpace();
        result.put("freeSpace", freeSpace);
        result.put("freeSpaceGB", freeSpace / (1024 * 1024 * 1024));
        result.put("totalSpace", totalSpace);
        result.put("totalSpaceGB", totalSpace / (1024 * 1024 * 1024));
        
        // Device info
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("model", Build.MODEL);
        result.put("device", Build.DEVICE);
        result.put("androidVersion", Build.VERSION.RELEASE);
        result.put("sdkVersion", Build.VERSION.SDK_INT);
        
        call.resolve(result);
    }
    
    @PluginMethod
    public void initInference(PluginCall call) {
        String modelPath = call.getString("modelPath");
        int contextLength = call.getInt("contextLength", 2048);
        
        if (modelPath == null) {
            File modelDir = getModelDirectory();
            File modelFile = new File(modelDir, MODEL_FILE_NAME);
            if (!modelFile.exists()) {
                call.reject("Model not found");
                return;
            }
            modelPath = modelFile.getAbsolutePath();
        }
        
        try {
            String sessionId = UUID.randomUUID().toString();
            LlamaInference inference = new LlamaInference(modelPath, contextLength);
            activeSessions.put(sessionId, inference);
            
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("sessionId", sessionId);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to initialize inference: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void generate(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String prompt = call.getString("prompt");
        float temperature = call.getFloat("temperature", 0.7f);
        int maxTokens = call.getInt("maxTokens", 512);
        
        if (sessionId == null || prompt == null) {
            call.reject("Missing required parameters");
            return;
        }
        
        LlamaInference inference = activeSessions.get(sessionId);
        if (inference == null) {
            call.reject("Inference session not found");
            return;
        }
        
        executor.execute(() -> {
            try {
                String response = inference.generate(prompt, temperature, maxTokens);
                
                new Handler(Looper.getMainLooper()).post(() -> {
                    JSObject result = new JSObject();
                    result.put("text", response);
                    result.put("success", true);
                    call.resolve(result);
                });
            } catch (Exception e) {
                new Handler(Looper.getMainLooper()).post(() -> {
                    call.reject("Generation failed: " + e.getMessage());
                });
            }
        });
    }
    
    @PluginMethod
    public void closeSession(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId != null) {
            LlamaInference inference = activeSessions.remove(sessionId);
            if (inference != null) {
                inference.close();
            }
        }
        
        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }
    
    private File getModelDirectory() {
        File filesDir = getContext().getFilesDir();
        File modelDir = new File(filesDir, MODEL_DIR);
        if (!modelDir.exists()) {
            modelDir.mkdirs();
        }
        return modelDir;
    }
    
    private void handleDownloadComplete(long downloadId) {
        DownloadManager.Query query = new DownloadManager.Query();
        query.setFilterById(downloadId);
        Cursor cursor = downloadManager.query(query);
        
        if (cursor.moveToFirst()) {
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            String uriString = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
            
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                File downloadedFile = new File(Uri.parse(uriString).getPath());
                File modelDir = getModelDirectory();
                File finalFile = new File(modelDir, MODEL_FILE_NAME);
                
                if (downloadedFile.renameTo(finalFile)) {
                    // Create info file
                    try {
                        JSONObject info = new JSONObject();
                        info.put("modelId", "unknown");
                        info.put("downloadedAt", System.currentTimeMillis());
                        info.put("size", finalFile.length());
                        writeFile(new File(modelDir, MODEL_INFO_FILE), info.toString());
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to write model info", e);
                    }
                    
                    notifyListeners("downloadComplete", new JSObject());
                } else {
                    notifyListeners("downloadError", createErrorObject("Failed to move downloaded file"));
                }
            } else {
                notifyListeners("downloadError", createErrorObject("Download failed: " + reason));
            }
        }
        cursor.close();
    }
    
    private void monitorDownloadProgress(long downloadId, PluginCall call, String modelId, long expectedSize) {
        executor.execute(() -> {
            boolean downloading = true;
            while (downloading) {
                DownloadManager.Query query = new DownloadManager.Query();
                query.setFilterById(downloadId);
                Cursor cursor = downloadManager.query(query);
                
                if (cursor.moveToFirst()) {
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    
                    if (status == DownloadManager.STATUS_RUNNING) {
                        long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        
                        if (total > 0) {
                            int progress = (int) ((downloaded * 100) / total);
                            
                            JSObject progressData = new JSObject();
                            progressData.put("progress", progress);
                            progressData.put("downloadedBytes", downloaded);
                            progressData.put("totalBytes", total);
                            progressData.put("modelId", modelId);
                            
                            new Handler(Looper.getMainLooper()).post(() -> {
                                notifyListeners("downloadProgress", progressData);
                            });
                        }
                    } else if (status == DownloadManager.STATUS_SUCCESSFUL || status == DownloadManager.STATUS_FAILED) {
                        downloading = false;
                    }
                } else {
                    downloading = false;
                }
                cursor.close();
                
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    break;
                }
            }
        });
    }
    
    private long getTotalRAM() {
        try {
            RandomAccessFile reader = new RandomAccessFile("/proc/meminfo", "r");
            String line = reader.readLine();
            reader.close();
            String[] parts = line.split("\\s+");
            return Long.parseLong(parts[1]) * 1024;
        } catch (IOException e) {
            return 0;
        }
    }
    
    private long getFreeRAM() {
        android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
        android.app.ActivityManager activityManager = (android.app.ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        activityManager.getMemoryInfo(mi);
        return mi.availMem;
    }
    
    private boolean deleteRecursive(File file) {
        if (file == null) return true;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        return file.delete();
    }
    
    private String readFile(File file) throws IOException {
        StringBuilder sb = new StringBuilder();
        BufferedReader reader = new BufferedReader(new FileReader(file));
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        reader.close();
        return sb.toString();
    }
    
    private void writeFile(File file, String content) throws IOException {
        RandomAccessFile raf = new RandomAccessFile(file, "rw");
        raf.setLength(0);
        raf.write(content.getBytes());
        raf.close();
    }
    
    private JSObject createErrorObject(String message) {
        JSObject error = new JSObject();
        error.put("error", message);
        return error;
    }
    
    /**
     * Simple Llama inference wrapper using llama.cpp
     * Note: This is a simplified implementation. For production, use the full llama.cpp JNI bindings.
     */
    private static class LlamaInference {
        private final String modelPath;
        private final int contextLength;
        private long nativeHandle = 0;
        private final AtomicBoolean closed = new AtomicBoolean(false);
        
        static {
            try {
                System.loadLibrary("llama");
            } catch (UnsatisfiedLinkError e) {
                Log.w(TAG, "Native llama library not available: " + e.getMessage());
            }
        }
        
        public LlamaInference(String modelPath, int contextLength) throws Exception {
            this.modelPath = modelPath;
            this.contextLength = contextLength;
            
            File modelFile = new File(modelPath);
            if (!modelFile.exists()) {
                throw new Exception("Model file not found: " + modelPath);
            }
            
            // Initialize native model (would call JNI here in full implementation)
            // For now, we'll use a placeholder that returns simple responses
        }
        
        public String generate(String prompt, float temperature, int maxTokens) {
            if (closed.get()) {
                return "Error: Inference session closed";
            }
            
            // Simulated response for demonstration
            // In production, this would call llama.cpp through JNI
            try {
                Thread.sleep(500); // Simulate processing time
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            
            return "[Local LLaMA model response placeholder]\n\nThis is a simulated response. " +
                   "In production, this would use llama.cpp native bindings for actual inference.\n\n" +
                   "Prompt: " + prompt.substring(0, Math.min(100, prompt.length())) + "...";
        }
        
        public void close() {
            closed.set(true);
        }
    }
}
