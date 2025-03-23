import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";

// Create an MCP server
const server = new McpServer({
    name: "URL-Fetcher",
    version: "1.0.0",
});

// Store recently fetched URLs
const recentUrls: Array<{ url: string; timestamp: number; contentType: string }> = [];

// Helper function to record URL fetches
function recordUrlFetch(url: string, contentType: string) {
    recentUrls.unshift({ url, timestamp: Date.now(), contentType });
    // Keep only the 10 most recent
    if (recentUrls.length > 10) {
        recentUrls.pop();
    }
}

// Helper function to fetch data from a URL
async function fetchUrl(url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response;
    } catch (error) {
        console.error(`Error fetching URL: ${url}`, error);
        throw error;
    }
}

// Add resource to list recently fetched URLs
server.resource("recent-urls", "recent-urls://list", async (uri) => {
    const urlList = recentUrls.map((item) => `- ${item.url} (${item.contentType}) fetched at ${new Date(item.timestamp).toLocaleString()}`).join("\n");

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
        format: z.enum(["auto", "html", "json", "markdown", "text"]).optional().describe("Format to fetch (default: auto)"),
    },
    async ({ url, format = "auto" }) => {
        try {
            const response = await fetchUrl(url);

            // Determine content type
            let contentType = format;
            if (format === "auto") {
                const responseContentType = response.headers.get("content-type") || "";
                if (responseContentType.includes("html")) {
                    contentType = "html";
                } else if (responseContentType.includes("json")) {
                    contentType = "json";
                } else if (responseContentType.includes("markdown") || responseContentType.includes("md") || url.endsWith(".md") || url.endsWith(".markdown")) {
                    contentType = "markdown";
                } else {
                    contentType = "text";
                }
            }

            // Get the content
            const rawContent = await response.text();
            let processedContent = rawContent;

            // Process based on content type
            if (contentType === "json") {
                try {
                    const jsonData = JSON.parse(rawContent);
                    processedContent = JSON.stringify(jsonData, null, 2);
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error parsing JSON: ${error instanceof Error ? error.message : String(error)}`,
                            },
                        ],
                    };
                }
            }

            // Record this fetch
            recordUrlFetch(url, contentType as string);

            return {
                content: [
                    {
                        type: "text",
                        text: `# Content fetched as ${contentType}:\n\n${processedContent}`,
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

// HTML-specific fetcher
server.tool(
    "fetch-html",
    "Fetch HTML content from a URL",
    {
        url: z.string().url().describe("URL to fetch HTML from"),
        extractText: z.boolean().optional().describe("Whether to extract text content only (default: false)"),
    },
    async ({ url, extractText = false }) => {
        try {
            const response = await fetchUrl(url);
            const html = await response.text();

            // Record this fetch
            recordUrlFetch(url, "html");

            // If extractText is true, use a simple regex to strip HTML tags
            const content = extractText
                ? html
                      .replace(/<[^>]*>/g, " ")
                      .replace(/\s+/g, " ")
                      .trim()
                : html;

            return {
                content: [{ type: "text", text: content }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching HTML from URL: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// JSON-specific fetcher
server.tool(
    "fetch-json",
    "Fetch and parse JSON content from a URL",
    {
        url: z.string().url().describe("URL to fetch JSON from"),
        prettyPrint: z.boolean().optional().describe("Whether to pretty-print the JSON (default: true)"),
        path: z.string().optional().describe("Optional JSONPath-like expression to extract specific data"),
    },
    async ({ url, prettyPrint = true, path }) => {
        try {
            const response = await fetchUrl(url);
            const jsonText = await response.text();

            // Record this fetch
            recordUrlFetch(url, "json");

            let jsonData;

            try {
                jsonData = JSON.parse(jsonText);
            } catch (parseError) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: `Error parsing JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                        },
                    ],
                };
            }

            // Extract data if path is specified
            if (path) {
                try {
                    const pathParts = path.split(".");
                    let currentData = jsonData;

                    for (const part of pathParts) {
                        if (currentData === undefined || currentData === null) {
                            throw new Error(`Path '${path}' not found in JSON data`);
                        }
                        currentData = currentData[part];
                    }

                    jsonData = currentData;
                } catch (pathError) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error extracting data from path '${path}': ${pathError instanceof Error ? pathError.message : String(pathError)}`,
                            },
                        ],
                    };
                }
            }

            const result = prettyPrint ? JSON.stringify(jsonData, null, 2) : JSON.stringify(jsonData);

            return {
                content: [{ type: "text", text: result }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching JSON from URL: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Markdown-specific fetcher
server.tool(
    "fetch-markdown",
    "Fetch Markdown content from a URL",
    {
        url: z.string().url().describe("URL to fetch Markdown from"),
    },
    async ({ url }) => {
        try {
            const response = await fetchUrl(url);
            const markdown = await response.text();

            // Record this fetch
            recordUrlFetch(url, "markdown");

            return {
                content: [{ type: "text", text: markdown }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching Markdown from URL: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Plain text fetcher
server.tool(
    "fetch-text",
    "Fetch plain text content from a URL",
    {
        url: z.string().url().describe("URL to fetch content from"),
    },
    async ({ url }) => {
        try {
            const response = await fetchUrl(url);
            const text = await response.text();

            // Record this fetch
            recordUrlFetch(url, "text");

            return {
                content: [{ type: "text", text }],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching text from URL: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }
    }
);

// Add helpful prompts
server.prompt(
    "fetch-website",
    {
        url: z.string().describe("URL of the website to fetch"),
        format: z.enum(["html", "text"]).optional().describe("Format to fetch (default: text)"),
    },
    ({ url, format = "text" }) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Please fetch and analyze the content from this website: ${url}. ${
                        format === "text" ? "Extract the main text content." : "Analyze the HTML structure."
                    }`,
                },
            },
        ],
    })
);

server.prompt(
    "fetch-api",
    {
        url: z.string().describe("URL of the API endpoint"),
        path: z.string().optional().describe("Optional JSON path to extract specific data"),
    },
    ({ url, path }) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Please fetch data from this API endpoint: ${url}${
                        path ? `\nPlease extract the data at path: ${path}` : ""
                    }\nThen analyze and explain the data.`,
                },
            },
        ],
    })
);

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
