"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessingHelper = void 0;
// ProcessingHelper.ts
const node_fs_1 = __importDefault(require("node:fs"));
const axios_1 = __importStar(require("axios"));
const openai_1 = require("openai");
const ConfigHelper_1 = require("./ConfigHelper");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
// --- Constants for Model Names ---
const OPENAI_EXTRACTION_MODEL = "gpt-4o";
const OPENAI_SOLUTION_MODEL = "gpt-4o";
const OPENAI_DEBUGGING_MODEL = "gpt-4o";
// Per user request, keeping gemini-2.5-pro
const GEMINI_EXTRACTION_MODEL = "gemini-2.5-pro";
const GEMINI_SOLUTION_MODEL = "gemini-2.5-pro";
const GEMINI_DEBUGGING_MODEL = "gemini-2.5-pro";
const ANTHROPIC_EXTRACTION_MODEL = "claude-3-5-sonnet-20240620";
const ANTHROPIC_SOLUTION_MODEL = "claude-3-5-sonnet-20240620";
const ANTHROPIC_DEBUGGING_MODEL = "claude-3-5-sonnet-20240620";
class ProcessingHelper {
    constructor(deps) {
        this.openaiClient = null;
        this.geminiApiKey = null;
        this.anthropicClient = null;
        this.currentProcessingAbortController = null;
        this.currentExtraProcessingAbortController = null;
        this.deps = deps;
        this.screenshotHelper = deps.getScreenshotHelper();
        this.initializeAIClient();
        ConfigHelper_1.configHelper.on('config-updated', () => {
            this.initializeAIClient();
        });
    }
    /**
     * Initialize or reinitialize the AI client with the current config.
     */
    initializeAIClient() {
        // Reset all clients first to handle provider switches
        this.openaiClient = null;
        this.geminiApiKey = null;
        this.anthropicClient = null;
        try {
            const config = ConfigHelper_1.configHelper.loadConfig();
            if (!config.apiKey) {
                console.warn(`No API key available for provider '${config.apiProvider}', client not initialized`);
                return;
            }
            if (config.apiProvider === "openai") {
                this.openaiClient = new openai_1.OpenAI({
                    apiKey: config.apiKey,
                    timeout: 60000,
                    maxRetries: 2
                });
                console.log("OpenAI client initialized successfully");
            }
            else if (config.apiProvider === "gemini") {
                this.geminiApiKey = config.apiKey;
                console.log("Gemini API key set successfully");
            }
            else if (config.apiProvider === "anthropic") {
                this.anthropicClient = new sdk_1.default({
                    apiKey: config.apiKey,
                    timeout: 60000,
                    maxRetries: 2
                });
                console.log("Anthropic client initialized successfully");
            }
        }
        catch (error) {
            console.error("Failed to initialize AI client:", error);
        }
    }
    /**
     * Checks if the currently configured AI client is properly initialized.
     */
    isClientInitialized() {
        const config = ConfigHelper_1.configHelper.loadConfig();
        switch (config.apiProvider) {
            case "openai":
                return !!this.openaiClient;
            case "gemini":
                return !!this.geminiApiKey;
            case "anthropic":
                return !!this.anthropicClient;
            default:
                return false;
        }
    }
    async waitForInitialization(mainWindow) {
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds total
        while (attempts < maxAttempts) {
            const isInitialized = await mainWindow.webContents.executeJavaScript("window.__IS_INITIALIZED__");
            if (isInitialized)
                return;
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
        }
        throw new Error("App failed to initialize after 5 seconds");
    }
    async getCredits() {
        return 999; // Unlimited credits
    }
    async getLanguage() {
        try {
            const config = ConfigHelper_1.configHelper.loadConfig();
            if (config.language) {
                return config.language;
            }
            return "python"; // Default fallback
        }
        catch (error) {
            console.error("Error getting language:", error);
            return "python";
        }
    }
    /**
     * Helper to check for cancellation errors from different sources.
     */
    isAbortError(error) {
        return (0, axios_1.isCancel)(error) || (error instanceof Error && error.name === 'AbortError');
    }
    async processScreenshots() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return;
        // Simplified client validation
        if (!this.isClientInitialized()) {
            this.initializeAIClient(); // Attempt to re-initialize
            if (!this.isClientInitialized()) {
                const provider = ConfigHelper_1.configHelper.loadConfig().apiProvider;
                console.error(`${provider} client is not initialized.`);
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
                return;
            }
        }
        const view = this.deps.getView();
        console.log("Processing screenshots in view:", view);
        if (view === "queue") {
            await this.handleInitialProcessing();
        }
        else { // view === 'solutions'
            await this.handleExtraProcessing();
        }
    }
    async handleInitialProcessing() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return;
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
        const screenshotQueue = this.screenshotHelper.getScreenshotQueue().filter(p => node_fs_1.default.existsSync(p));
        if (screenshotQueue.length === 0) {
            console.log("No valid screenshot files found in queue.");
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
            return;
        }
        this.currentProcessingAbortController = new AbortController();
        const { signal } = this.currentProcessingAbortController;
        try {
            const screenshots = await Promise.all(screenshotQueue.map(async (path) => ({
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: node_fs_1.default.readFileSync(path).toString('base64')
            })));
            const result = await this.processScreenshotsHelper(screenshots, signal);
            if (result.success) {
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS, result.data);
                this.deps.setView("solutions");
            }
            else {
                console.error("Processing failed:", result.error);
                const event = result.error?.includes("API key")
                    ? this.deps.PROCESSING_EVENTS.API_KEY_INVALID
                    : this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR;
                mainWindow.webContents.send(event, result.error);
                this.deps.setView("queue");
            }
        }
        catch (error) {
            console.error("Processing error:", error);
            const errorMessage = this.isAbortError(error)
                ? "Processing was canceled by the user."
                : error.message || "An unexpected error occurred.";
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, errorMessage);
            this.deps.setView("queue");
        }
        finally {
            this.currentProcessingAbortController = null;
        }
    }
    async handleExtraProcessing() {
        const mainWindow = this.deps.getMainWindow();
        if (!mainWindow)
            return;
        const extraScreenshotQueue = this.screenshotHelper.getExtraScreenshotQueue().filter(p => node_fs_1.default.existsSync(p));
        if (extraScreenshotQueue.length === 0) {
            console.log("No valid extra screenshot files found.");
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
            return;
        }
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START);
        this.currentExtraProcessingAbortController = new AbortController();
        const { signal } = this.currentExtraProcessingAbortController;
        try {
            const allPaths = [
                ...this.screenshotHelper.getScreenshotQueue(),
                ...extraScreenshotQueue
            ].filter(p => node_fs_1.default.existsSync(p));
            const screenshots = await Promise.all(allPaths.map(async (path) => ({
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: node_fs_1.default.readFileSync(path).toString('base64')
            })));
            const result = await this.processExtraScreenshotsHelper(screenshots, signal);
            if (result.success) {
                this.deps.setHasDebugged(true);
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS, result.data);
            }
            else {
                mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, result.error);
            }
        }
        catch (error) {
            const errorMessage = this.isAbortError(error)
                ? "Debugging was canceled by the user."
                : error.message || "An unexpected error occurred during debugging.";
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, errorMessage);
        }
        finally {
            this.currentExtraProcessingAbortController = null;
        }
    }
    async processScreenshotsHelper(screenshots, signal) {
        const config = ConfigHelper_1.configHelper.loadConfig();
        const language = await this.getLanguage();
        const mainWindow = this.deps.getMainWindow();
        const imageDataList = screenshots.map(screenshot => screenshot.data);
        try {
            mainWindow?.webContents.send("processing-status", { message: "Analyzing problem from screenshots...", progress: 20 });
            let problemInfo;
            let responseText;
            if (config.apiProvider === "openai") {
                if (!this.openaiClient)
                    return { success: false, error: "OpenAI client not initialized." };
                const response = await this.openaiClient.chat.completions.create({
                    model: config.extractionModel || OPENAI_EXTRACTION_MODEL,
                    messages: [
                        { role: "system", content: "You are a coding challenge interpreter. Analyze the screenshot of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text." },
                        { role: "user", content: [{ type: "text", text: `Extract the coding problem details from these screenshots. Return in JSON format. The target language is ${language}.` }, ...imageDataList.map(data => ({ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } }))] }
                    ],
                    max_tokens: 4096, temperature: 0.2
                }, { signal });
                responseText = response.choices[0].message.content;
            }
            else if (config.apiProvider === "gemini") {
                if (!this.geminiApiKey)
                    return { success: false, error: "Gemini API key not configured." };
                const geminiMessages = [{ role: "user", parts: [{ text: `You are a coding challenge interpreter. Analyze the screenshots of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text. The target language is ${language}.` }, ...imageDataList.map(data => ({ inlineData: { mimeType: "image/png", data } }))] }];
                const response = await axios_1.default.post(`https://generativelanguage.googleapis.com/v1beta/models/${config.extractionModel || GEMINI_EXTRACTION_MODEL}:generateContent?key=${this.geminiApiKey}`, { contents: geminiMessages, generationConfig: { temperature: 0.2, maxOutputTokens: 8192 } }, { signal });
                const responseData = response.data;
                responseText = responseData.candidates?.[0]?.content.parts[0].text;
            }
            else if (config.apiProvider === "anthropic") {
                if (!this.anthropicClient)
                    return { success: false, error: "Anthropic client not initialized." };
                const response = await this.anthropicClient.messages.create({
                    model: config.extractionModel || ANTHROPIC_EXTRACTION_MODEL,
                    max_tokens: 4096,
                    messages: [{ role: "user", content: [{ type: "text", text: `Extract the coding problem details from these screenshots. Return in JSON format with these fields: problem_statement, constraints, example_input, example_output. The target language is ${language}.` }, ...imageDataList.map(data => ({ type: "image", source: { type: "base64", media_type: "image/png", data } }))] }],
                    temperature: 0.2
                }, { signal });
                responseText = response.content[0].text;
            }
            if (!responseText) {
                return { success: false, error: "Received an empty response from the AI." };
            }
            try {
                const jsonText = responseText.replace(/```json|```/g, '').trim();
                problemInfo = JSON.parse(jsonText);
            }
            catch (parseError) {
                console.error("Error parsing JSON from AI response:", parseError, "Raw text:", responseText);
                return { success: false, error: "Could not understand the problem from the screenshots. Please try again with a clearer image." };
            }
            mainWindow?.webContents.send("processing-status", { message: "Problem analyzed. Generating solution...", progress: 40 });
            this.deps.setProblemInfo(problemInfo);
            const solutionsResult = await this.generateSolutionsHelper(signal);
            if (!solutionsResult.success) {
                throw new Error(solutionsResult.error || "Failed to generate solutions.");
            }
            this.screenshotHelper.clearExtraScreenshotQueue();
            mainWindow?.webContents.send("processing-status", { message: "Solution generated successfully!", progress: 100 });
            return { success: true, data: solutionsResult.data };
        }
        catch (error) {
            if (this.isAbortError(error)) {
                return { success: false, error: "Processing was canceled." };
            }
            console.error("API Error in processScreenshotsHelper:", error);
            return { success: false, error: error.message || "An API error occurred." };
        }
    }
    async generateSolutionsHelper(signal) {
        const problemInfo = this.deps.getProblemInfo();
        const language = await this.getLanguage();
        const config = ConfigHelper_1.configHelper.loadConfig();
        const mainWindow = this.deps.getMainWindow();
        if (!problemInfo)
            return { success: false, error: "Problem information is missing." };
        const promptText = `Generate a detailed and optimized solution for the following coding problem in ${language}:\n\nPROBLEM STATEMENT:\n${problemInfo.problem_statement}\n\nCONSTRAINTS:\n${problemInfo.constraints || "N/A"}\n\nEXAMPLE INPUT:\n${problemInfo.example_input || "N/A"}\n\nEXAMPLE OUTPUT:\n${problemInfo.example_output || "N/A"}\n\nProvide the response in this format:\n1. Code: Clean, optimized implementation.\n2. Your Thoughts: Key insights and reasoning.\n3. Time complexity: O(X) with a detailed explanation.\n4. Space complexity: O(X) with a detailed explanation.`;
        try {
            mainWindow?.webContents.send("processing-status", { message: "Creating optimal solution...", progress: 60 });
            let responseContent;
            if (config.apiProvider === "openai") {
                if (!this.openaiClient)
                    return { success: false, error: "OpenAI client not initialized." };
                const response = await this.openaiClient.chat.completions.create({
                    model: config.solutionModel || OPENAI_SOLUTION_MODEL,
                    messages: [{ role: "system", content: "You are an expert coding interview assistant." }, { role: "user", content: promptText }],
                    max_tokens: 4096, temperature: 0.2
                }, { signal });
                responseContent = response.choices[0].message.content;
            }
            else if (config.apiProvider === "gemini") {
                if (!this.geminiApiKey)
                    return { success: false, error: "Gemini API key not configured." };
                const response = await axios_1.default.post(`https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || GEMINI_SOLUTION_MODEL}:generateContent?key=${this.geminiApiKey}`, { contents: [{ role: "user", parts: [{ text: promptText }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192 } }, { signal });
                responseContent = response.data.candidates?.[0]?.content.parts[0].text;
            }
            else if (config.apiProvider === "anthropic") {
                if (!this.anthropicClient)
                    return { success: false, error: "Anthropic client not initialized." };
                const response = await this.anthropicClient.messages.create({
                    model: config.solutionModel || ANTHROPIC_SOLUTION_MODEL, max_tokens: 4096,
                    messages: [{ role: "user", content: promptText }], temperature: 0.2
                }, { signal });
                responseContent = response.content[0].text;
            }
            if (!responseContent) {
                return { success: false, error: "Received an empty solution from the AI." };
            }
            const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
            const code = codeMatch ? codeMatch[1].trim() : "// Could not extract code from response.";
            const thoughtsMatch = responseContent.match(/(?:Your Thoughts|Key Insights)[\s\S]*?(?=Time complexity:|$)/i);
            const thoughts = thoughtsMatch ? thoughtsMatch[0].match(/[-*•]\s*(.*)/g)?.map(t => t.replace(/[-*•]\s*/, '')) || ["No specific thoughts provided."] : ["No specific thoughts provided."];
            const timeComplexityMatch = responseContent.match(/Time complexity:([\s\S]*?)(?=Space complexity:|$)/i);
            const spaceComplexityMatch = responseContent.match(/Space complexity:([\s\S]*)/i);
            return { success: true, data: {
                    code,
                    thoughts,
                    time_complexity: timeComplexityMatch ? timeComplexityMatch[1].trim() : "Not specified.",
                    space_complexity: spaceComplexityMatch ? spaceComplexityMatch[1].trim() : "Not specified."
                } };
        }
        catch (error) {
            if (this.isAbortError(error)) {
                return { success: false, error: "Solution generation was canceled." };
            }
            console.error("Solution generation error:", error);
            return { success: false, error: error.message || "Failed to generate solution." };
        }
    }
    async processExtraScreenshotsHelper(screenshots, signal) {
        const problemInfo = this.deps.getProblemInfo();
        const language = await this.getLanguage();
        const config = ConfigHelper_1.configHelper.loadConfig();
        const mainWindow = this.deps.getMainWindow();
        if (!problemInfo)
            return { success: false, error: "Problem info not found for debugging." };
        const imageDataList = screenshots.map(s => s.data);
        const debugPrompt = `You are a coding debugger. I'm solving: "${problemInfo.problem_statement}" in ${language}. Analyze my code from the screenshots and provide feedback. Structure your response with these exact markdown headers: ### Issues Identified, ### Specific Improvements and Corrections, ### Optimizations, ### Explanation of Changes Needed, ### Key Points.`;
        try {
            mainWindow?.webContents.send("processing-status", { message: "Debugging with AI...", progress: 50 });
            let debugContent;
            if (config.apiProvider === "openai") {
                if (!this.openaiClient)
                    return { success: false, error: "OpenAI client not initialized." };
                const response = await this.openaiClient.chat.completions.create({
                    model: config.debuggingModel || OPENAI_DEBUGGING_MODEL,
                    messages: [{ role: "system", content: "You are a debugging assistant." }, { role: "user", content: [{ type: "text", text: debugPrompt }, ...imageDataList.map(data => ({ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } }))] }],
                    max_tokens: 4096, temperature: 0.2
                }, { signal });
                debugContent = response.choices[0].message.content;
            }
            else if (config.apiProvider === "gemini") {
                if (!this.geminiApiKey)
                    return { success: false, error: "Gemini API key not configured." };
                const response = await axios_1.default.post(`https://generativelanguage.googleapis.com/v1beta/models/${config.debuggingModel || GEMINI_DEBUGGING_MODEL}:generateContent?key=${this.geminiApiKey}`, { contents: [{ role: "user", parts: [{ text: debugPrompt }, ...imageDataList.map(data => ({ inlineData: { mimeType: "image/png", data } }))] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192 } }, { signal });
                debugContent = response.data.candidates?.[0]?.content.parts[0].text;
            }
            else if (config.apiProvider === "anthropic") {
                if (!this.anthropicClient)
                    return { success: false, error: "Anthropic client not initialized." };
                const response = await this.anthropicClient.messages.create({
                    model: config.debuggingModel || ANTHROPIC_DEBUGGING_MODEL, max_tokens: 4096,
                    messages: [{ role: "user", content: [{ type: "text", text: debugPrompt }, ...imageDataList.map(data => ({ type: "image", source: { type: "base64", media_type: "image/png", data } }))] }],
                    temperature: 0.2
                }, { signal });
                debugContent = response.content[0].text;
            }
            if (!debugContent) {
                return { success: false, error: "Received an empty debug response from the AI." };
            }
            mainWindow?.webContents.send("processing-status", { message: "Debug analysis complete", progress: 100 });
            return { success: true, data: {
                    code: "// Debug analysis provided",
                    debug_analysis: debugContent,
                    thoughts: ["Debug analysis based on your screenshots"],
                    time_complexity: "N/A - Debug mode",
                    space_complexity: "N/A - Debug mode"
                } };
        }
        catch (error) {
            if (this.isAbortError(error)) {
                return { success: false, error: "Debugging was canceled." };
            }
            console.error("Debug processing error:", error);
            return { success: false, error: error.message || "Failed to process debug request." };
        }
    }
    cancelOngoingRequests() {
        let wasCancelled = false;
        if (this.currentProcessingAbortController) {
            this.currentProcessingAbortController.abort();
            this.currentProcessingAbortController = null;
            wasCancelled = true;
        }
        if (this.currentExtraProcessingAbortController) {
            this.currentExtraProcessingAbortController.abort();
            this.currentExtraProcessingAbortController = null;
            wasCancelled = true;
        }
        this.deps.setHasDebugged(false);
        this.deps.setProblemInfo(null);
        const mainWindow = this.deps.getMainWindow();
        if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        }
    }
}
exports.ProcessingHelper = ProcessingHelper;
