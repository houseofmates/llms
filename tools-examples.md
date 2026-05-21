# tools system usage guide

your llms app now has an openwebui-style tools system integrated! here's how to use it.

## overview

the tools system allows your local qwen and llama models to:
- connect to mcp (model context protocol) servers
- query your nocobase data
- trigger n8n workflows via webhooks
- call any external api
- read/write local files (android/electron only)

## quick start

1. **open settings** → click the gear icon
2. **go to "tools & integrations" tab**
3. **enable tools** with the toggle
4. **configure your services**:
   - mcp server url and api key
   - nocobase url and api key
   - n8n webhook key (optional)

## how to use tools in chat

when talking to qwen or llama offline, you can ask the model to perform actions using the tool format:

### examples

**query nocobase data:**
```
can you check my nocobase database for all projects created this week?
```

**trigger n8n workflow:**
```
run my daily report workflow in n8n
```

**connect to mcp:**
```
connect to my mcp server and get the current context
```

**generic api call:**
```
fetch data from http://localhost:8080/api/status
```

## tool call format (for advanced users)

if the model doesn't automatically detect tool needs, you can manually trigger tools:

```xml
<tool_call tool="nocobase-api">
{
  "endpoint": "projects",
  "method": "GET"
}
</tool_call>
```

```xml
<tool_call tool="n8n-webhook">
{
  "webhookUrl": "https://your-n8n-instance.com/webhook/abc123",
  "data": {
    "action": "trigger"
  }
}
</tool_call>
```

## generating api keys for external connections

you can generate api keys that external services can use to connect back to your llms app:

1. in tools settings, click **"generate mcp key"** (or nocobase/n8n)
2. the key is auto-copied to clipboard
3. paste it in the external service's configuration

generated keys are stored in `localStorage` and persist across sessions.

## available tools

### 1. mcp connector
- **id**: `mcp-connector`
- **type**: mcp
- **purpose**: connect to model context protocol servers
- **parameters**: serverUrl, action, data
- **example**: access external knowledge bases, code repositories, etc.

### 2. nocobase api
- **id**: `nocobase-api`
- **type**: nocobase
- **purpose**: query and manipulate nocobase data
- **parameters**: endpoint, method, data
- **example**: get records, create entries, update data

### 3. n8n webhook
- **id**: `n8n-webhook`
- **type**: webhook
- **purpose**: trigger n8n automation workflows
- **parameters**: webhookUrl, data
- **example**: start automations, send notifications, process data

### 4. generic api
- **id**: `generic-api`
- **type**: api
- **purpose**: make http requests to any endpoint
- **parameters**: url, method, headers, data
- **example**: fetch from custom apis, microservices, etc.

### 5. local files
- **id**: `local-files`
- **type**: local
- **purpose**: read/write local files
- **parameters**: action (read/write/list), path, content
- **note**: only available in android apk and electron builds

## security notes

- all api keys are stored in browser `localStorage` (client-side only)
- keys are never transmitted except to your configured endpoints
- tool execution requires explicit user action (the model can't silently call tools)
- generated api keys are prefixed with `llms_` for identification

## troubleshooting

**tools not working?**
- verify the model is qwen or llama-offline (tools don't work with cloud apis)
- check that tools are enabled in settings
- verify your service urls and api keys are correct
- check browser console for error messages

**model doesn't understand tool requests?**
- be explicit: "use the nocobase tool to..."
- or use the manual xml format shown above
- include the tool name in your request

**api calls failing?**
- check cors settings on your services
- verify network connectivity
- check that api keys have correct permissions

## extending the tools system

you can add custom tools by modifying `tools-system.js`:

```javascript
toolsManager.registerTool(new ToolDefinition({
    id: 'my-custom-tool',
    name: 'my custom tool',
    description: 'does something cool',
    type: 'api',
    parameters: {
        param1: { type: 'string', required: true }
    }
}));
```

## examples

### example 1: daily standup assistant
```
can you check my nocobase for all tasks updated today and summarize them in a standup format?
```

### example 2: automation trigger
```
trigger my n8n workflow to backup the database
```

### example 3: data analysis
```
get all sales records from nocobase for last month and analyze the trends
```

### example 4: mcp integration
```
connect to my mcp git server and show me the recent commits
```

## configuration reference

| setting | storage key | description |
|---------|-------------|-------------|
| tools enabled | `llms_tools_enabled` | master toggle |
| mcp url | `llms_api_keys` → `mcpUrl` | mcp server endpoint |
| mcp key | `llms_api_keys` → `mcp` | authentication key |
| nocobase url | `llms_api_keys` → `nocobaseUrl` | nocobase endpoint |
| nocobase key | `llms_api_keys` → `nocobase` | authentication token |
| n8n key | `llms_api_keys` → `n8n` | webhook authentication |
| generated keys | `llms_generated_api_keys` | keys for external services |

---

*tools system integrated with llms app - enables local models to interact with your infrastructure*
