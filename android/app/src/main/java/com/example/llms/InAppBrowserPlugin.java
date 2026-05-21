package com.example.llms;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "InAppBrowser")
public class InAppBrowserPlugin extends Plugin {
    
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "browser");
        
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        
        Intent intent = new Intent(getContext(), InAppBrowserActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        getActivity().startActivity(intent);
        
        call.resolve();
    }
}
