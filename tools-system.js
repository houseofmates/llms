// tools-system.js - OpenWebUI-style tools integration for llms app
// Enables local models (Qwen, Llama) to call external APIs and services

const TOOLS_STORAGE_KEY = 'llms_tools_config';
const TOOLS_ENABLED_KEY = 'llms_tools_enabled';
const GENERATED_API_KEYS_KEY = 'llms_generated_api_keys';

// Tool definition format (compatible with OpenWebUI)
class ToolDefinition {
    constructor(config) {
        this.id = config.id;
        this.name = config.name;
        this.description = config.description;
        this.type = config.type || 'api'; // 'api', 'mcp', 'webhook', 'nocobase', 'n8n'
        this.enabled = config.enabled !== false;
        this.parameters = config.parameters || {};
        this.authentication = config.authentication || {};
        this.endpoint = config.endpoint;
        this.method = config.method || 'POST';
        this.headers = config.headers || {};
        this.timeout = config.timeout || 30000;
        this.rateLimit = config.rateLimit;
    }
}

// Tools manager class
class ToolsManager {
    constructor() {
        this.tools = new Map();
        this.enabled = this.loadToolsEnabled();
        this.generatedKeys = this.loadGeneratedKeys();
        this.executionQueue = [];
        this.isExecuting = false;
        this.loadDefaultTools();
    }

    loadToolsEnabled() {
        try {
            return localStorage.getItem(TOOLS_ENABLED_KEY) === 'true';
        } catch {
            return false; // Default to disabled for security
        }
    }

    loadGeneratedKeys() {
        try {
            return JSON.parse(localStorage.getItem(GENERATED_API_KEYS_KEY) || '{}');
        } catch {
            return {};
        }
    }

    loadDefaultTools() {
        // MCP (Model Context Protocol) connector
        this.registerTool(new ToolDefinition({
            id: 'mcp-connector',
            name: 'mcp connector',
            description: 'connect to mcp servers for extended capabilities',
            type: 'mcp',
            parameters: {
                serverUrl: { type: 'string', required: true, description: 'mcp server url' },
                action: { type: 'string', required: true, description: 'action to perform' },
                data: { type: 'object', required: false, description: 'additional data' }
            },
            authentication: {
                type: 'api_key',
                keyParam: 'apiKey'
            }
        }));

        // NocoBase API connector
        this.registerTool(new ToolDefinition({
            id: 'nocobase-api',
            name: 'nocobase api',
            description: 'query and manipulate nocobase data',
            type: 'nocobase',
            parameters: {
                endpoint: { type: 'string', required: true, description: 'api endpoint path' },
                method: { type: 'string', required: false, default: 'GET', description: 'http method' },
                data: { type: 'object', required: false, description: 'request data' }
            },
            authentication: {
                type: 'bearer_token',
                keyParam: 'token'
            }
        }));

        // n8n webhook connector
        this.registerTool(new ToolDefinition({
            id: 'n8n-webhook',
            name: 'n8n webhook',
            description: 'trigger n8n workflows via webhooks',
            type: 'webhook',
            parameters: {
                webhookUrl: { type: 'string', required: true, description: 'n8n webhook url' },
                data: { type: 'object', required: false, description: 'workflow data' }
            },
            authentication: {
                type: 'api_key',
                keyParam: 'apiKey'
            }
        }));

        // Generic API caller
        this.registerTool(new ToolDefinition({
            id: 'generic-api',
            name: 'generic api',
            description: 'make http requests to any api endpoint',
            type: 'api',
            parameters: {
                url: { type: 'string', required: true, description: 'api endpoint url' },
                method: { type: 'string', required: false, default: 'GET', description: 'http method' },
                headers: { type: 'object', required: false, description: 'custom headers' },
                data: { type: 'object', required: false, description: 'request body data' }
            },
            authentication: {
                type: 'custom',
                supported: ['api_key', 'bearer_token', 'basic_auth']
            }
        }));

        // Local file system (for Electron/Android)
        this.registerTool(new ToolDefinition({
            id: 'local-files',
            name: 'local files',
            description: 'read and write local files (desktop/android only)',
            type: 'local',
            parameters: {
                action: { type: 'string', required: true, enum: ['read', 'write', 'list'], description: 'file operation' },
                path: { type: 'string', required: true, description: 'file path' },
                content: { type: 'string', required: false, description: 'file content for write operations' }
            },
            authentication: {
                type: 'none'
            }
        }));
    }

    registerTool(tool) {
        this.tools.set(tool.id, tool);
    }

    enableTools() {
        this.enabled = true;
        localStorage.setItem(TOOLS_ENABLED_KEY, 'true');
    }

    disableTools() {
        this.enabled = false;
        localStorage.setItem(TOOLS_ENABLED_KEY, 'false');
    }

    // Parse message for tool calls (OpenWebUI format)
    parseToolCalls(message) {
        const toolCallPattern = /<tool_call\s+([^>]+)>([\s\S]*?)<\/tool_call>/g;
        const calls = [];
        let match;

        while ((match = toolCallPattern.exec(message)) !== null) {
            try {
                const attrs = this.parseAttributes(match[1]);
                const toolId = attrs.tool;
                const tool = this.tools.get(toolId);
                
                if (!tool) {
                    continue;
                }

                const parameters = this.parseParameters(match[2], tool.parameters);
                calls.push({
                    tool: toolId,
                    parameters,
                    originalText: match[0]
                });
            } catch (error) {
                console.error('[tools] failed to parse tool call:', error);
            }
        }

        return calls;
    }

    parseAttributes(attrString) {
        const attrs = {};
        const attrPattern = /(\w+)="([^"]*)"/g;
        let match;

        while ((match = attrPattern.exec(attrString)) !== null) {
            attrs[match[1]] = match[2];
        }

        return attrs;
    }

    parseParameters(paramString, schema) {
        const params = {};
        
        // Simple JSON parsing for now
        try {
            if (paramString.trim()) {
                return JSON.parse(paramString);
            }
        } catch (error) {
            // Fallback to key=value parsing
            const lines = paramString.split('\n');
            for (const line of lines) {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    params[key.trim()] = valueParts.join('=').trim();
                }
            }
        }

        return params;
    }

    // Execute a tool call
    async executeToolCall(toolCall) {
        const tool = this.tools.get(toolCall.tool);
        if (!tool || !tool.enabled) {
            throw new Error(`tool ${toolCall.tool} not found or disabled`);
        }

        console.log(`[tools] executing ${tool.name}:`, toolCall.parameters);

        switch (tool.type) {
            case 'mcp':
                return await this.executeMcpCall(tool, toolCall.parameters);
            case 'nocobase':
                return await this.executeNocoBaseCall(tool, toolCall.parameters);
            case 'webhook':
                return await this.executeWebhookCall(tool, toolCall.parameters);
            case 'api':
                return await this.executeGenericApiCall(tool, toolCall.parameters);
            case 'local':
                return await this.executeLocalCall(tool, toolCall.parameters);
            default:
                throw new Error(`unsupported tool type: ${tool.type}`);
        }
    }

    async executeMcpCall(tool, params) {
        const keys = getApiKeys();
        const apiKey = keys.mcp || this.generatedKeys.mcp;

        if (!apiKey) {
            throw new Error('mcp api key not configured');
        }

        const response = await fetch(params.serverUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                ...tool.headers
            },
            body: JSON.stringify({
                action: params.action,
                data: params.data
            })
        });

        if (!response.ok) {
            throw new Error(`mcp call failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async executeNocoBaseCall(tool, params) {
        const keys = getApiKeys();
        const nocobaseUrl = keys.nocobaseUrl || localStorage.getItem('llms_nocobase_url');
        const nocobaseKey = keys.nocobase || this.generatedKeys.nocobase;

        if (!nocobaseUrl || !nocobaseKey) {
            throw new Error('nocobase url or api key not configured');
        }

        const url = `${nocobaseUrl.replace(/\/$/, '')}/api/${params.endpoint.replace(/^\//, '')}`;
        const method = params.method || 'GET';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${nocobaseKey}`,
                ...tool.headers
            },
            body: method !== 'GET' ? JSON.stringify(params.data) : undefined
        });

        if (!response.ok) {
            throw new Error(`nocobase call failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async executeWebhookCall(tool, params) {
        const keys = getApiKeys();
        const apiKey = keys.n8n || this.generatedKeys.n8n;

        const headers = {
            'Content-Type': 'application/json',
            ...tool.headers
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(params.webhookUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(params.data)
        });

        if (!response.ok) {
            throw new Error(`n8n webhook failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async executeGenericApiCall(tool, params) {
        const headers = {
            'Content-Type': 'application/json',
            ...params.headers,
            ...tool.headers
        };

        // Handle authentication
        if (params.apiKey) {
            headers['Authorization'] = `Bearer ${params.apiKey}`;
        } else if (params.token) {
            headers['Authorization'] = `Bearer ${params.token}`;
        }

        const response = await fetch(params.url, {
            method: params.method || 'GET',
            headers,
            body: params.method !== 'GET' ? JSON.stringify(params.data) : undefined
        });

        if (!response.ok) {
            throw new Error(`api call failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    async executeLocalCall(tool, params) {
        // Only available in Electron or Android contexts
        if (window.electronAPI) {
            return await window.electronAPI.executeLocalFileOperation(params);
        } else if (window.Capacitor && window.Capacitor.platform !== 'web') {
            return await window.Capacitor.Plugins.FilesystemOperations.execute(params);
        } else {
            throw new Error('local file operations not supported in web browser');
        }
    }

    // Process message for tool calls and execute them
    async processMessage(message) {
        if (!this.enabled) {
            return message;
        }

        const toolCalls = this.parseToolCalls(message);
        if (toolCalls.length === 0) {
            return message;
        }

        let processedMessage = message;
        const results = [];

        for (const toolCall of toolCalls) {
            try {
                const result = await this.executeToolCall(toolCall);
                results.push({
                    tool: toolCall.tool,
                    success: true,
                    result
                });

                // Replace tool call with result
                const resultText = `<tool_result tool="${toolCall.tool}">${JSON.stringify(result)}</tool_result>`;
                processedMessage = processedMessage.replace(toolCall.originalText, resultText);

            } catch (error) {
                results.push({
                    tool: toolCall.tool,
                    success: false,
                    error: error.message
                });

                // Replace tool call with error
                const errorText = `<tool_error tool="${toolCall.tool}">${error.message}</tool_error>`;
                processedMessage = processedMessage.replace(toolCall.originalText, errorText);
            }
        }

        return processedMessage;
    }

    // Generate API key for external services to connect to this app
    generateApiKey(serviceName) {
        const key = `llms_${serviceName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.generatedKeys[serviceName] = key;
        localStorage.setItem(GENERATED_API_KEYS_KEY, JSON.stringify(this.generatedKeys));
        return key;
    }

    // Get tool definitions for UI
    getToolDefinitions() {
        return Array.from(this.tools.values()).map(tool => ({
            id: tool.id,
            name: tool.name,
            description: tool.description,
            type: tool.type,
            enabled: tool.enabled,
            parameters: tool.parameters
        }));
    }
}

// Global tools manager instance
let toolsManager;

// Initialize tools system
function initializeToolsSystem() {
    toolsManager = new ToolsManager();
    
    // Auto-enable for qwen only (llama-offline uses llama-server which handles tools differently)
    const currentModel = typeof currentApiMode !== 'undefined' ? currentApiMode : null;
    if (currentModel === 'qwen') {
        toolsManager.enableTools();
        console.log('[tools] auto-enabled for local model:', currentModel);
    }
}

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ToolsManager, ToolDefinition, initializeToolsSystem };
}
