import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { marked } from "marked";
import TurndownService from "turndown";
import { XMLParser } from "fast-xml-parser";
import sanitizeHtml from "sanitize-html";
import csvtojson from "csvtojson";
import { Parser as Json2csvParser } from "json2csv";
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from "playwright";

// Create an MCP server
const server = new McpServer({
    name: "URL-Fetcher",
    version: "1.0.1",
});

// Initialize format converters
const turndownService = new TurndownService();
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
});

// Store recently fetched URLs
const recentUrls: Array<{ url: string; timestamp: number; outputFormat: string; method: string }> = [];

// Browser instance cache (lazy initialization)
let browserInstance: Browser | null = null;
let browserContext: BrowserContext | null = null;

// Helper function to record URL fetches
function recordUrlFetch(url: string, outputFormat: string, method: string = "fetch") {
    recentUrls.unshift({ url, timestamp: Date.now(), outputFormat, method });
    // Keep only the 10 most recent
    if (recentUrls.length > 10) {
        recentUrls.pop();
    }
}

// Helper function to get or create a browser instance
async function getBrowser(engine: "chromium" | "firefox" | "webkit" = "chromium"): Promise<Browser> {
    if (!browserInstance) {
        console.error(`Initializing ${engine} browser...`);
        switch (engine) {
            case "firefox":
                browserInstance = await firefox.launch({ headless: true });
                break;
            case "webkit":
                browserInstance = await webkit.launch({ headless: true });
                break;
            case "chromium":
            default:
                browserInstance = await chromium.launch({
                    headless: true,
                    args: ["--disable-web-security", "--no-sandbox", "--disable-setuid-sandbox"],
                });
        }
    }
    return browserInstance;
}

// Helper function to get a browser context
async function getBrowserContext(engine: "chromium" | "firefox" | "webkit" = "chromium"): Promise<BrowserContext> {
    if (!browserContext) {
        const browser = await getBrowser(engine);
        browserContext = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
            hasTouch: false,
            javaScriptEnabled: true,
            locale: "en-US",
            timezoneId: "America/Los_Angeles",
        });
    }
    return browserContext;
}

// Helper function to fetch data from a URL using Playwright
async function fetchUrlWithPlaywright(
    url: string,
    options: {
        engine?: "chromium" | "firefox" | "webkit";
        waitForSelector?: string;
        waitForTimeout?: number;
        evalScript?: string;
        scrollToBottom?: boolean;
        screenshot?: boolean;
    } = {}
): Promise<{
    content: string;
    screenshot?: Buffer;
    contentType: string;
}> {
    const { engine = "chromium", waitForSelector, waitForTimeout = 3000, evalScript, scrollToBottom = false, screenshot = false } = options;

    const context = await getBrowserContext(engine);
    const page = await context.newPage();

    try {
        console.error(`Navigating to ${url} with Playwright...`);

        // Set default timeout to 30 seconds
        page.setDefaultTimeout(30000);

        // Navigate to the URL
        await page.goto(url, { waitUntil: "domcontentloaded" });

        // Wait for specific selector if provided
        if (waitForSelector) {
            await page.waitForSelector(waitForSelector, { timeout: 15000 });
        }

        // Default wait time to let JS execute
        await page.waitForTimeout(waitForTimeout);

        // Scroll to bottom to load lazy content if requested
        if (scrollToBottom) {
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(1000);
        }

        // Execute custom JavaScript if provided
        let customResult;
        if (evalScript) {
            customResult = await page.evaluate(evalScript);
        }

        // Take screenshot if requested
        let screenshotBuffer;
        if (screenshot) {
            screenshotBuffer = await page.screenshot({ fullPage: true });
        }

        // Get the page content
        const content = await page.content();

        // Detect content type based on response headers or content
        const contentType = await page.evaluate(() => {
            const contentType = document.contentType || document.querySelector("meta[http-equiv='Content-Type']")?.getAttribute("content");
            return contentType || "text/html";
        });

        return {
            content: customResult || content,
            screenshot: screenshotBuffer,
            contentType,
        };
    } catch (error) {
        console.error(`Error fetching with Playwright: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    } finally {
        await page.close();
    }
}

// Helper function to fetch data from a URL (with fallback to Playwright)
async function fetchUrl(
    url: string,
    options: {
        usePlaywright?: boolean;
        playwrightOptions?: {
            engine?: "chromium" | "firefox" | "webkit";
            waitForSelector?: string;
            waitForTimeout?: number;
            evalScript?: string;
            scrollToBottom?: boolean;
            screenshot?: boolean;
        };
    } = {}
): Promise<{
    contentText: string;
    contentType: string;
    headers: any;
    screenshot?: Buffer;
}> {
    const { usePlaywright = false, playwrightOptions = {} } = options;

    try {
        if (usePlaywright) {
            // Use Playwright for dynamic content
            const result = await fetchUrlWithPlaywright(url, playwrightOptions);
            return {
                contentText: result.content,
                contentType: result.contentType || "text/html",
                headers: { "content-type": result.contentType || "text/html" },
                screenshot: result.screenshot,
            };
        } else {
            // Use simple fetch for static content
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentText = await response.text();
            return {
                contentText,
                contentType: response.headers.get("content-type") || "text/plain",
                headers: Object.fromEntries(response.headers.entries()),
            };
        }
    } catch (error) {
        console.error(`Error in fetchUrl for ${url}: ${error instanceof Error ? error.message : String(error)}`);

        // If simple fetch fails, try with Playwright as a fallback
        if (!usePlaywright) {
            console.error(`Falling back to Playwright for ${url}...`);
            return fetchUrl(url, { usePlaywright: true, playwrightOptions });
        }

        throw error;
    }
}

// Helper function to detect content type from response or content
function detectContentType(contentType: string, url: string, content: string): string {
    // Check based on content-type header
    if (contentType.includes("json")) return "json";
    if (contentType.includes("html")) return "html";
    if (contentType.includes("markdown") || contentType.includes("md")) return "markdown";
    if (contentType.includes("xml")) return "xml";
    if (contentType.includes("csv")) return "csv";

    // If no clear content-type, check the URL extension
    if (url.endsWith(".json")) return "json";
    if (url.endsWith(".html") || url.endsWith(".htm")) return "html";
    if (url.endsWith(".md") || url.endsWith(".markdown")) return "markdown";
    if (url.endsWith(".xml")) return "xml";
    if (url.endsWith(".csv")) return "csv";

    // Try to detect from content
    if (content.trim().startsWith("{") && content.trim().endsWith("}")) {
        try {
            JSON.parse(content);
            return "json";
        } catch (e) {
            // Not valid JSON
        }
    }

    if (content.trim().startsWith("<") && content.includes("</html>")) {
        return "html";
    }

    if (content.includes("<?xml") || (content.includes("<") && content.includes("/>"))) {
        return "xml";
    }

    // Check if it looks like CSV (contains commas and newlines)
    if (content.includes(",") && content.includes("\n") && !content.includes("<") && !content.includes("{")) {
        const lines = content.split("\n").filter((line) => line.trim());
        if (lines.length > 1) {
            const headerCommas = (lines[0].match(/,/g) || []).length;
            const dataCommas = (lines[1].match(/,/g) || []).length;
            if (headerCommas > 0 && headerCommas === dataCommas) {
                return "csv";
            }
        }
    }

    // Default to text
    return "text";
}

// Add resource to list recently fetched URLs
server.resource("recent-urls", "recent-urls://list", async (uri) => {
    const urlList = recentUrls
        .map((item) => `- ${item.url} (converted to ${item.outputFormat} using ${item.method}) fetched at ${new Date(item.timestamp).toLocaleString()}`)
        .join("\n");

    return {
        contents: [
            {
                uri: uri.href,
                text: urlList.length > 0 ? urlList : "No URLs have been fetched yet.",
            },
        ],
    };
});

// Unified fetch tool with format detection
server.tool(
    "fetch",
    "Fetch content from a URL with automatic content type detection",
    {
        url: z.string().url().describe("URL to fetch content from"),
        format: z.enum(["auto", "html", "json", "markdown", "text"]).optional().describe("Format to convert to (default: auto)"),
        usePlaywright: z.boolean().optional().describe("Whether to use Playwright browser for rendering (default: auto-detect)"),
        waitTime: z.number().optional().describe("Time to wait for JavaScript execution in milliseconds (default: 3000)"),
        waitForSelector: z.string().optional().describe("CSS selector to wait for before capturing content"),
        scrollToBottom: z.boolean().optional().describe("Whether to scroll to the bottom of the page to load lazy content (default: false)"),
        engine: z.enum(["chromium", "firefox", "webkit"]).optional().describe("Browser engine to use (default: chromium)"),
    },
    async ({ url, format = "auto", usePlaywright, waitTime = 3000, waitForSelector, scrollToBottom = false, engine = "chromium" }) => {
        try {
            // Determine if we should use Playwright based on URL or explicit flag
            const shouldUsePlaywright =
                usePlaywright !== undefined
                    ? usePlaywright
                    : url.includes("twitter.com") ||
                      url.includes("facebook.com") ||
                      url.includes("instagram.com") ||
                      url.includes("linkedin.com") ||
                      url.includes("reddit.com") ||
                      url.includes("youtube.com");

            const playwrightOptions = {
                engine,
                waitForTimeout: waitTime,
                waitForSelector,
                scrollToBottom,
            };

            const { contentText, contentType, headers, screenshot } = await fetchUrl(url, {
                usePlaywright: shouldUsePlaywright,
                playwrightOptions,
            });

            const detectedType = detectContentType(contentType, url, contentText);

            // If format is auto, use the detected type or default to text
            let outputFormat = format;
            if (format === "auto") {
                outputFormat = detectedType;
            }

            let processedContent;
            let processedScreenshot = "";

            // Convert to the desired output format
            switch (outputFormat) {
                case "json":
                    processedContent = await convertToJson(contentText, detectedType, url);
                    break;
                case "markdown":
                    processedContent = await convertToMarkdown(contentText, detectedType, url);
                    if (screenshot) {
                        processedScreenshot = `\n\n## Screenshot\n\n![Screenshot of ${url}](data:image/png;base64,${screenshot.toString("base64")})\n`;
                    }
                    break;
                case "html":
                    processedContent = await convertToHtml(contentText, detectedType, url);
                    if (screenshot) {
                        processedScreenshot = `<h2>Screenshot</h2><img src="data:image/png;base64,${screenshot.toString(
                            "base64"
                        )}" alt="Screenshot of ${url}" style="max-width:100%;">`;
                        processedContent = processedContent.replace("</body>", `${processedScreenshot}</body>`);
                        processedScreenshot = ""; // Already included in HTML
                    }
                    break;
                case "text":
                default:
                    processedContent = await convertToText(contentText, detectedType, url);
                    outputFormat = "text";
                    if (screenshot) {
                        processedScreenshot = `\n\n[Screenshot was captured but cannot be displayed in text format]\n`;
                    }
                    break;
            }

            // Record this fetch
            recordUrlFetch(url, outputFormat, shouldUsePlaywright ? "Playwright" : "fetch");

            return {
                content: [
                    {
                        type: "text",
                        text: `# Content from ${url} converted to ${outputFormat}:\n\n${processedContent}${processedScreenshot}`,
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching content from URL: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Convert to JSON format
server.tool(
    "fetch-json",
    "Fetch content from any URL and convert to JSON format",
    {
        url: z.string().url().describe("URL to fetch content from"),
        prettyPrint: z.boolean().optional().describe("Whether to pretty-print the JSON (default: true)"),
        usePlaywright: z.boolean().optional().describe("Whether to use Playwright browser for rendering (default: auto-detect)"),
        waitTime: z.number().optional().describe("Time to wait for JavaScript execution in milliseconds (default: 3000)"),
        waitForSelector: z.string().optional().describe("CSS selector to wait for before capturing content"),
        extractData: z.boolean().optional().describe("Whether to extract structured data from the page (default: true)"),
    },
    async ({ url, prettyPrint = true, usePlaywright, waitTime = 3000, waitForSelector, extractData = true }) => {
        try {
            // Determine if we should use Playwright based on URL or explicit flag
            const shouldUsePlaywright =
                usePlaywright !== undefined
                    ? usePlaywright
                    : url.includes("twitter.com") ||
                      url.includes("facebook.com") ||
                      url.includes("instagram.com") ||
                      url.includes("linkedin.com") ||
                      url.includes("reddit.com") ||
                      url.includes("youtube.com");

            // Define a script to extract structured data if requested
            const evalScript = extractData
                ? `
        function extractStructuredData() {
          // Try to get JSON-LD data
          const jsonLdElements = document.querySelectorAll('script[type="application/ld+json"]');
          if (jsonLdElements.length > 0) {
            const jsonLdData = Array.from(jsonLdElements).map(el => {
              try {
                return JSON.parse(el.textContent);
              } catch (e) {
                return null;
              }
            }).filter(Boolean);
            if (jsonLdData.length > 0) return { jsonLd: jsonLdData };
          }
          
          // Extract meta tags
          const metaTags = {};
          document.querySelectorAll('meta').forEach(meta => {
            const name = meta.getAttribute('name') || meta.getAttribute('property');
            const content = meta.getAttribute('content');
            if (name && content) {
              metaTags[name] = content;
            }
          });
          
          // Basic page data
          return {
            title: document.title,
            url: window.location.href,
            metaTags,
            h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim()),
            h2: Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim()),
            links: Array.from(document.querySelectorAll('a[href]')).map(a => ({
              text: a.textContent.trim(),
              href: a.href
            })).filter(l => l.text && l.href)
          };
        }
        return extractStructuredData();
      `
                : undefined;

            const { contentText, contentType, headers } = await fetchUrl(url, {
                usePlaywright: shouldUsePlaywright,
                playwrightOptions: {
                    waitForTimeout: waitTime,
                    waitForSelector,
                    evalScript,
                },
            });

            const detectedType = detectContentType(contentType, url, contentText);

            let jsonContent;
            if (evalScript && shouldUsePlaywright && extractData) {
                // If we used the structured data extraction script, parse its result
                try {
                    jsonContent = JSON.stringify(JSON.parse(contentText), null, prettyPrint ? 2 : 0);
                } catch (e) {
                    // Fall back to standard conversion if parsing fails
                    jsonContent = await convertToJson(contentText, detectedType, url);
                }
            } else {
                jsonContent = await convertToJson(contentText, detectedType, url);
            }

            // Record this fetch
            recordUrlFetch(url, "json", shouldUsePlaywright ? "Playwright" : "fetch");

            return {
                content: [{ type: "text", text: jsonContent }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error converting to JSON: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Convert to HTML format
server.tool(
    "fetch-html",
    "Fetch content from any URL and convert to HTML format",
    {
        url: z.string().url().describe("URL to fetch content from"),
        usePlaywright: z.boolean().optional().describe("Whether to use Playwright browser for rendering (default: auto-detect)"),
        waitTime: z.number().optional().describe("Time to wait for JavaScript execution in milliseconds (default: 3000)"),
        waitForSelector: z.string().optional().describe("CSS selector to wait for before capturing content"),
        includeScreenshot: z.boolean().optional().describe("Whether to include a screenshot (default: false)"),
        extractText: z.boolean().optional().describe("Whether to extract text content only (default: false)"),
    },
    async ({ url, usePlaywright, waitTime = 3000, waitForSelector, includeScreenshot = false, extractText = false }) => {
        try {
            // Determine if we should use Playwright based on URL or explicit flag
            const shouldUsePlaywright =
                usePlaywright !== undefined
                    ? usePlaywright
                    : url.includes("twitter.com") ||
                      url.includes("facebook.com") ||
                      url.includes("instagram.com") ||
                      url.includes("linkedin.com") ||
                      url.includes("reddit.com") ||
                      url.includes("youtube.com");

            const { contentText, contentType, headers, screenshot } = await fetchUrl(url, {
                usePlaywright: shouldUsePlaywright,
                playwrightOptions: {
                    waitForTimeout: waitTime,
                    waitForSelector,
                    screenshot: includeScreenshot,
                },
            });

            const detectedType = detectContentType(contentType, url, contentText);

            let htmlContent;
            if (extractText) {
                const plainText = await convertToText(contentText, detectedType, url);
                htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Text content from ${url}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: 0 auto; }
    pre { background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Text content from ${escapeHtml(url)}</h1>
  <pre>${escapeHtml(plainText)}</pre>
</body>
</html>`;
            } else {
                htmlContent = await convertToHtml(contentText, detectedType, url);
            }

            // Add screenshot if available
            if (screenshot && includeScreenshot) {
                const screenshotHtml = `<h2>Screenshot</h2><img src="data:image/png;base64,${screenshot.toString(
                    "base64"
                )}" alt="Screenshot of ${url}" style="max-width:100%;">`;
                htmlContent = htmlContent.replace("</body>", `${screenshotHtml}</body>`);
            }

            // Record this fetch
            recordUrlFetch(url, "html", shouldUsePlaywright ? "Playwright" : "fetch");

            return {
                content: [{ type: "text", text: htmlContent }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error converting to HTML: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Convert to Markdown format
server.tool(
    "fetch-markdown",
    "Fetch content from any URL and convert to Markdown format",
    {
        url: z.string().url().describe("URL to fetch content from"),
        usePlaywright: z.boolean().optional().describe("Whether to use Playwright browser for rendering (default: auto-detect)"),
        waitTime: z.number().optional().describe("Time to wait for JavaScript execution in milliseconds (default: 3000)"),
        waitForSelector: z.string().optional().describe("CSS selector to wait for before capturing content"),
        includeScreenshot: z.boolean().optional().describe("Whether to include a screenshot (default: false)"),
    },
    async ({ url, usePlaywright, waitTime = 3000, waitForSelector, includeScreenshot = false }) => {
        try {
            // Determine if we should use Playwright based on URL or explicit flag
            const shouldUsePlaywright =
                usePlaywright !== undefined
                    ? usePlaywright
                    : url.includes("twitter.com") ||
                      url.includes("facebook.com") ||
                      url.includes("instagram.com") ||
                      url.includes("linkedin.com") ||
                      url.includes("reddit.com") ||
                      url.includes("youtube.com");

            const { contentText, contentType, headers, screenshot } = await fetchUrl(url, {
                usePlaywright: shouldUsePlaywright,
                playwrightOptions: {
                    waitForTimeout: waitTime,
                    waitForSelector,
                    screenshot: includeScreenshot,
                },
            });

            const detectedType = detectContentType(contentType, url, contentText);

            let markdownContent = await convertToMarkdown(contentText, detectedType, url);

            // Add screenshot if available
            if (screenshot && includeScreenshot) {
                markdownContent += `\n\n## Screenshot\n\n![Screenshot of ${url}](data:image/png;base64,${screenshot.toString("base64")})\n`;
            }

            // Record this fetch
            recordUrlFetch(url, "markdown", shouldUsePlaywright ? "Playwright" : "fetch");

            return {
                content: [{ type: "text", text: markdownContent }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error converting to Markdown: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Convert to plain text format
server.tool(
    "fetch-text",
    "Fetch content from any URL and convert to plain text format",
    {
        url: z.string().url().describe("URL to fetch content from"),
        usePlaywright: z.boolean().optional().describe("Whether to use Playwright browser for rendering (default: auto-detect)"),
        waitTime: z.number().optional().describe("Time to wait for JavaScript execution in milliseconds (default: 3000)"),
        waitForSelector: z.string().optional().describe("CSS selector to wait for before capturing content"),
    },
    async ({ url, usePlaywright, waitTime = 3000, waitForSelector }) => {
        try {
            // Determine if we should use Playwright based on URL or explicit flag
            const shouldUsePlaywright =
                usePlaywright !== undefined
                    ? usePlaywright
                    : url.includes("twitter.com") ||
                      url.includes("facebook.com") ||
                      url.includes("instagram.com") ||
                      url.includes("linkedin.com") ||
                      url.includes("reddit.com") ||
                      url.includes("youtube.com");

            // For text extraction, define a custom script to get clean text
            const evalScript = shouldUsePlaywright
                ? `
        function extractCleanText() {
          // Remove script and style elements
          const elements = document.querySelectorAll('script, style, noscript, iframe, svg');
          for (const element of elements) {
            element.remove();
          }
          
          // Extract title
          const title = document.title;
          
          // Extract main content (prefer main content areas)
          let mainContent = '';
          const contentElements = document.querySelectorAll('main, article, #content, .content, [role="main"]');
          if (contentElements.length > 0) {
            for (const element of contentElements) {
              mainContent += element.textContent + '\\n\\n';
            }
          } else {
            // Fallback to body if no main content elements found
            mainContent = document.body.textContent;
          }
          
          // Clean up the text
          let cleanText = mainContent
            .replace(/\\s+/g, ' ')
            .replace(/\\n\\s*\\n/g, '\\n\\n')
            .trim();
          
          return "Title: " + title + "\\n\\n" + cleanText;
        }
        return extractCleanText();
      `
                : undefined;

            const { contentText, contentType, headers } = await fetchUrl(url, {
                usePlaywright: shouldUsePlaywright,
                playwrightOptions: {
                    waitForTimeout: waitTime,
                    waitForSelector,
                    evalScript,
                },
            });

            const detectedType = detectContentType(contentType, url, contentText);

            const textContent = await convertToText(contentText, detectedType, url);

            // Record this fetch
            recordUrlFetch(url, "text", shouldUsePlaywright ? "Playwright" : "fetch");

            return {
                content: [{ type: "text", text: textContent }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error converting to text: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Take screenshot tool
server.tool(
    "screenshot",
    "Capture a screenshot of a webpage using Playwright",
    {
        url: z.string().url().describe("URL to capture screenshot of"),
        fullPage: z.boolean().optional().describe("Whether to capture the full page or just the viewport (default: true)"),
        waitTime: z.number().optional().describe("Time to wait for JavaScript execution in milliseconds (default: 3000)"),
        waitForSelector: z.string().optional().describe("CSS selector to wait for before capturing screenshot"),
        engine: z.enum(["chromium", "firefox", "webkit"]).optional().describe("Browser engine to use (default: chromium)"),
    },
    async ({ url, fullPage = true, waitTime = 3000, waitForSelector, engine = "chromium" }) => {
        try {
            const { screenshot } = await fetchUrl(url, {
                usePlaywright: true,
                playwrightOptions: {
                    engine,
                    waitForTimeout: waitTime,
                    waitForSelector,
                    screenshot: true,
                },
            });

            if (!screenshot) {
                throw new Error("Failed to capture screenshot");
            }

            // Record this fetch
            recordUrlFetch(url, "screenshot", "Playwright");

            const screenshotMarkdown = `# Screenshot of ${url}\n\n![Screenshot of ${url}](data:image/png;base64,${screenshot.toString("base64")})`;

            return {
                content: [{ type: "text", text: screenshotMarkdown }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error capturing screenshot: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Conversion functions
async function convertToJson(content: string, sourceType: string, sourceUrl: string): Promise<string> {
    try {
        switch (sourceType) {
            case "json":
                try {
                    // Verify it's valid JSON and pretty-print
                    const parsedJson = JSON.parse(content);
                    return JSON.stringify(parsedJson, null, 2);
                } catch (e) {
                    // If it's not valid JSON, return as string JSON
                    return JSON.stringify({ content });
                }
            case "html":
                // Convert HTML to a simplified JSON structure
                const $ = cheerio.load(content);
                const sanitizedHtml = sanitizeHtml(content);

                return JSON.stringify(
                    {
                        title: $("title").text(),
                        metaDescription: $('meta[name="description"]').attr("content") || "",
                        h1: $("h1")
                            .map((i, el) => $(el).text())
                            .get(),
                        text: $("body").text().trim(),
                        links: $("a")
                            .map((i, el) => ({
                                text: $(el).text(),
                                href: $(el).attr("href"),
                            }))
                            .get(),
                        htmlLength: sanitizedHtml.length,
                    },
                    null,
                    2
                );

            case "markdown":
                // Parse markdown to HTML first, then extract structure
                const html = marked.parse(content);
                const $md = cheerio.load(html);

                return JSON.stringify(
                    {
                        title: $md("h1").first().text() || "",
                        headings: $md("h1, h2, h3, h4, h5, h6")
                            .map((i, el) => ({
                                level: parseInt(el.tagName.substring(1)),
                                text: $md(el).text(),
                            }))
                            .get(),
                        text: $md("body").text().trim(),
                        links: $md("a")
                            .map((i, el) => ({
                                text: $md(el).text(),
                                href: $md(el).attr("href"),
                            }))
                            .get(),
                    },
                    null,
                    2
                );

            case "csv":
                // Convert CSV to JSON array
                const jsonArray = await csvtojson().fromString(content);
                return JSON.stringify(jsonArray, null, 2);

            case "xml":
                // Use fast-xml-parser to convert XML to JSON
                try {
                    const result = xmlParser.parse(content);
                    return JSON.stringify(result, null, 2);
                } catch (xmlError) {
                    throw new Error(`Failed to parse XML: ${xmlError instanceof Error ? xmlError.message : String(xmlError)}`);
                }

            default:
                // For other formats, wrap in a JSON object with metadata
                return JSON.stringify(
                    {
                        content,
                        type: sourceType,
                        source: sourceUrl,
                        timestamp: new Date().toISOString(),
                        length: content.length,
                    },
                    null,
                    2
                );
        }
    } catch (error) {
        throw new Error(`JSON conversion error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function convertToHtml(content: string, sourceType: string, sourceUrl: string): Promise<string> {
    try {
        switch (sourceType) {
            case "html":
                // Already HTML, just sanitize it
                return sanitizeHtml(content, {
                    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "h3", "h4", "h5", "h6"]),
                    allowedAttributes: {
                        ...sanitizeHtml.defaults.allowedAttributes,
                        img: ["src", "alt", "title", "width", "height"],
                        a: ["href", "name", "target"],
                    },
                });

            case "json":
                try {
                    // Format JSON as HTML
                    const jsonObj = JSON.parse(content);
                    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JSON Viewer</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; line-height: 1.6; padding: 20px; }
    pre { background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
    .json-key { color: #0033b3; }
    .json-string { color: #388E3C; }
    .json-number { color: #1976D2; }
    .json-boolean { color: #7E57C2; }
    .json-null { color: #5D4037; }
  </style>
</head>
<body>
  <h1>JSON Content</h1>
  <pre>${formatJsonForHtml(JSON.stringify(jsonObj, null, 2))}</pre>
  <footer>
    <p>Source: ${escapeHtml(sourceUrl)}</p>
    <p>Converted at: ${new Date().toLocaleString()}</p>
  </footer>
</body>
</html>`;
                } catch (e) {
                    return `<pre>${escapeHtml(content)}</pre>`;
                }

            case "markdown":
                // Convert markdown to HTML
                const htmlContent = marked.parse(content);

                return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Content</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: 0 auto; }
    img { max-width: 100%; height: auto; }
    pre { background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
    code { background-color: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
    blockquote { border-left: 4px solid #ddd; padding-left: 15px; color: #666; }
    table { border-collapse: collapse; width: 100%; }
    table, th, td { border: 1px solid #ddd; }
    th, td { padding: 8px; text-align: left; }
    th { background-color: #f5f5f5; }
  </style>
</head>
<body>
  ${htmlContent}
  <footer>
    <p>Source: ${escapeHtml(sourceUrl)}</p>
    <p>Converted at: ${new Date().toLocaleString()}</p>
  </footer>
</body>
</html>`;

            case "csv":
                // Convert CSV to HTML table
                const jsonData = await csvtojson().fromString(content);
                if (jsonData.length === 0) {
                    throw new Error("CSV data appears to be empty or invalid");
                }

                // Get headers from the first row
                const headers = Object.keys(jsonData[0]);

                // Generate HTML table
                let tableHtml = '<table border="1"><thead><tr>';

                // Add header row
                headers.forEach((header) => {
                    tableHtml += `<th>${escapeHtml(header)}</th>`;
                });
                tableHtml += "</tr></thead><tbody>";

                // Add data rows
                jsonData.forEach((row) => {
                    tableHtml += "<tr>";
                    headers.forEach((header) => {
                        tableHtml += `<td>${escapeHtml(String(row[header]))}</td>`;
                    });
                    tableHtml += "</tr>";
                });

                tableHtml += "</tbody></table>";

                return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CSV Data</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; padding: 20px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
    th, td { padding: 8px; text-align: left; border: 1px solid #ddd; }
    th { background-color: #f5f5f5; position: sticky; top: 0; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .container { max-height: 600px; overflow-y: auto; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>CSV Data</h1>
  <div class="container">
    ${tableHtml}
  </div>
  <footer>
    <p>Source: ${escapeHtml(sourceUrl)}</p>
    <p>Converted at: ${new Date().toLocaleString()}</p>
    <p>Total rows: ${jsonData.length}</p>
  </footer>
</body>
</html>`;

            case "xml":
                try {
                    // Parse XML to JSON then generate an HTML representation
                    const jsonObj = xmlParser.parse(content);

                    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XML Content</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; line-height: 1.6; padding: 20px; }
    pre { background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
    .xml-tag { color: #0033b3; }
    .xml-attr { color: #7E57C2; }
    .xml-content { color: #388E3C; }
  </style>
</head>
<body>
  <h1>XML Content</h1>
  <h2>Original XML</h2>
  <pre>${escapeHtml(content)}</pre>
  <h2>As JSON</h2>
  <pre>${formatJsonForHtml(JSON.stringify(jsonObj, null, 2))}</pre>
  <footer>
    <p>Source: ${escapeHtml(sourceUrl)}</p>
    <p>Converted at: ${new Date().toLocaleString()}</p>
  </footer>
</body>
</html>`;
                } catch (xmlError) {
                    return `<pre>${escapeHtml(content)}</pre>`;
                }

            default:
                // Wrap plain text in HTML
                return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Text Content</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; line-height: 1.6; padding: 20px; }
    pre { background-color: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Text Content</h1>
  <pre>${escapeHtml(content)}</pre>
  <footer>
    <p>Source: ${escapeHtml(sourceUrl)}</p>
    <p>Converted at: ${new Date().toLocaleString()}</p>
  </footer>
</body>
</html>`;
        }
    } catch (error) {
        throw new Error(`HTML conversion error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function convertToMarkdown(content: string, sourceType: string, sourceUrl: string): Promise<string> {
    try {
        let markdownContent = "";

        switch (sourceType) {
            case "markdown":
                return content; // Already Markdown

            case "html":
                // Use Turndown to convert HTML to Markdown
                const sanitizedHtml = sanitizeHtml(content, {
                    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "h3", "h4", "h5", "h6"]),
                    allowedAttributes: {
                        ...sanitizeHtml.defaults.allowedAttributes,
                        img: ["src", "alt", "title"],
                        a: ["href", "name", "target"],
                    },
                });

                markdownContent = turndownService.turndown(sanitizedHtml);

                // Add source info at the end
                markdownContent += `\n\n---\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}\n`;
                return markdownContent;

            case "json":
                try {
                    // Format JSON as markdown code block
                    const jsonObj = JSON.parse(content);
                    const formattedJson = JSON.stringify(jsonObj, null, 2);

                    markdownContent = `# JSON Content\n\n\`\`\`json\n${formattedJson}\n\`\`\`\n\n`;
                    markdownContent += `Source: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}\n`;
                    return markdownContent;
                } catch (e) {
                    return `\`\`\`\n${content}\n\`\`\`\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}\n`;
                }

            case "csv":
                // Convert CSV to JSON, then create a Markdown table
                const jsonData = await csvtojson().fromString(content);
                if (jsonData.length === 0) {
                    throw new Error("CSV data appears to be empty or invalid");
                }

                // Get headers from the first row
                const headers = Object.keys(jsonData[0]);

                // Create table header
                let mdTable = `# CSV Data\n\n`;
                mdTable += `| ${headers.join(" | ")} |\n`;
                mdTable += `| ${headers.map(() => "---").join(" | ")} |\n`;

                // Add data rows (limit to first 50 rows for markdown readability)
                const maxRows = Math.min(jsonData.length, 50);
                for (let i = 0; i < maxRows; i++) {
                    const row = jsonData[i];
                    mdTable += `| ${headers.map((h) => String(row[h] || "").replace(/\|/g, "\\|")).join(" | ")} |\n`;
                }

                if (jsonData.length > 50) {
                    mdTable += `\n*Table truncated. Total rows: ${jsonData.length}*\n`;
                }

                mdTable += `\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}\n`;

                return mdTable;

            case "xml":
                // Convert XML to markdown representation
                try {
                    const result = xmlParser.parse(content);
                    const formattedJson = JSON.stringify(result, null, 2);

                    markdownContent = `# XML Content\n\n## As JSON\n\n\`\`\`json\n${formattedJson}\n\`\`\`\n\n`;
                    markdownContent += `## Original XML\n\n\`\`\`xml\n${content}\n\`\`\`\n\n`;
                    markdownContent += `Source: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}\n`;
                    return markdownContent;
                } catch (xmlError) {
                    return `\`\`\`\n${content}\n\`\`\`\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}\n`;
                }

            default:
                // Wrap plain text in a code block if it's short, otherwise just format with headers
                if (content.length < 1000) {
                    return `# Content\n\n\`\`\`\n${content}\n\`\`\`\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}\n`;
                } else {
                    return `# Content\n\n${content}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}\n`;
                }
        }
    } catch (error) {
        throw new Error(`Markdown conversion error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function convertToText(content: string, sourceType: string, sourceUrl: string): Promise<string> {
    try {
        switch (sourceType) {
            case "html":
                // Use cheerio to extract just the text content
                const $ = cheerio.load(content);

                // Remove script and style elements
                $("script, style").remove();

                // Get text with newlines preserved for structural elements
                const extractedText = $("body").text().replace(/\s+/g, " ").trim();

                return `${extractedText}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;

            case "json":
                try {
                    // Format JSON as indented text
                    const jsonObj = JSON.parse(content);
                    return `${JSON.stringify(jsonObj, null, 2)}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;
                } catch (e) {
                    return `${content}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;
                }

            case "markdown":
                // Remove markdown formatting
                const textContent = content
                    .replace(/#+\s+/g, "") // Remove heading markers
                    .replace(/\*\*(.*?)\*\*/g, "$1") // Remove bold markers
                    .replace(/\*(.*?)\*/g, "$1") // Remove italic markers
                    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)") // Convert links to text
                    .replace(/!\[(.*?)\]\((.*?)\)/g, "[Image: $1]") // Replace images
                    .replace(/`{3}[\s\S]*?`{3}/g, "") // Remove code blocks
                    .replace(/`(.*?)`/g, "$1") // Remove inline code
                    .replace(/^\s*[-*+]\s+/gm, "- "); // Normalize list items

                return `${textContent}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;

            case "csv":
                // Convert CSV to a simple text table
                const jsonData = await csvtojson().fromString(content);
                if (jsonData.length === 0) {
                    return `Empty or invalid CSV data\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;
                }

                // Get headers from the first row
                const headers = Object.keys(jsonData[0]);

                // Build a simple text representation (limited to 25 rows for readability)
                let textTable = headers.join(" | ") + "\n";
                textTable += headers.map(() => "---").join("-|-") + "\n";

                const maxRows = Math.min(jsonData.length, 25);
                for (let i = 0; i < maxRows; i++) {
                    const row = jsonData[i];
                    textTable += headers.map((h) => String(row[h] || "")).join(" | ") + "\n";
                }

                if (jsonData.length > 25) {
                    textTable += `\n[Table truncated. Total rows: ${jsonData.length}]\n`;
                }

                return `${textTable}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;

            case "xml":
                try {
                    // Convert XML to plain text (via JSON for readability)
                    const result = xmlParser.parse(content);
                    return `${JSON.stringify(result, null, 2)}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;
                } catch (xmlError) {
                    // If XML parsing fails, return the raw content
                    return `${content}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;
                }

            default:
                // Already text
                return `${content}\n\nSource: ${sourceUrl}\nConverted: ${new Date().toLocaleString()}`;
        }
    } catch (error) {
        throw new Error(`Text conversion error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Helper functions
function escapeHtml(unsafe: string): string {
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatJsonForHtml(json: string): string {
    return json
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
        .replace(/"([^"]+)"/g, '<span class="json-string">"$1"</span>')
        .replace(/\b(\d+)\b/g, '<span class="json-number">$1</span>')
        .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
        .replace(/\bnull\b/g, '<span class="json-null">null</span>');
}

// Helper function to clean up resources
async function cleanupResources() {
    if (browserContext) {
        await browserContext.close().catch(console.error);
        browserContext = null;
    }

    if (browserInstance) {
        await browserInstance.close().catch(console.error);
        browserInstance = null;
    }
}

// Set up cleanup handlers
process.on("exit", async () => {
    console.error("Process exit, cleaning up resources...");
    cleanupResources().catch(console.error);
});

process.on("SIGINT", async () => {
    console.error("Received SIGINT, cleaning up resources...");
    await cleanupResources();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.error("Received SIGTERM, cleaning up resources...");
    await cleanupResources();
    process.exit(0);
});

// Start the server
async function main() {
    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("URL Fetcher MCP Server running...");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
