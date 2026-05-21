package com.example.llms;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

public class TWALauncherActivity extends AppCompatActivity {
    private TwaLauncher twaLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        Uri url = getIntent().getData();
        if (url == null) {
            finish();
            return;
        }
        
        twaLauncher = new TwaLauncher(this);
        twaLauncher.launch(url);
        
        // Finish this activity immediately - TWA takes over
        finish();
    }
    
    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (twaLauncher != null) {
            twaLauncher.destroy();
        }
    }
}
