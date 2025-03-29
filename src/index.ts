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

// Create an MCP server
const server = new McpServer({
  name: "URL-Fetcher",
  version: "1.0.0",
});

// Initialize format converters
const turndownService = new TurndownService();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
});

// Store recently fetched URLs
const recentUrls: Array<{ url: string; timestamp: number; outputFormat: string }> = [];

// Helper function to record URL fetches
function recordUrlFetch(url: string, outputFormat: string) {
  recentUrls.unshift({ url, timestamp: Date.now(), outputFormat });
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

// Helper function to detect content type from response
function detectContentType(response, url: string): string {
  const contentType = response.headers.get("content-type") || "";

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

  // Default to text
  return "text";
}

// Add resource to list recently fetched URLs
server.resource("recent-urls", "recent-urls://list", async (uri) => {
  const urlList = recentUrls
    .map((item) => `- ${item.url} (converted to ${item.outputFormat}) fetched at ${new Date(item.timestamp).toLocaleString()}`)
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
  },
  async ({ url, format = "auto" }) => {
    try {
      const response = await fetchUrl(url);
      const contentBuffer = await response.buffer();
      const contentText = contentBuffer.toString();
      const detectedType = detectContentType(response, url);

      // If format is auto, use the detected type or default to text
      let outputFormat = format;
      if (format === "auto") {
        outputFormat = detectedType;
      }

      let processedContent;

      // Convert to the desired output format
      switch (outputFormat) {
        case "json":
          processedContent = await convertToJson(contentText, detectedType, url);
          break;
        case "markdown":
          processedContent = await convertToMarkdown(contentText, detectedType, url);
          break;
        case "html":
          processedContent = await convertToHtml(contentText, detectedType, url);
          break;
        case "text":
        default:
          processedContent = await convertToText(contentText, detectedType, url);
          outputFormat = "text";
          break;
      }

      // Record this fetch
      recordUrlFetch(url, outputFormat);

      return {
        content: [
          {
            type: "text",
            text: `# Content from ${url} converted to ${outputFormat}:\n\n${processedContent}`,
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
  },
  async ({ url, prettyPrint = true }) => {
    try {
      const response = await fetchUrl(url);
      const contentText = await response.text();
      const detectedType = detectContentType(response, url);

      const jsonContent = await convertToJson(contentText, detectedType, url);
      const formattedJson = prettyPrint
        ? typeof jsonContent === "string"
          ? jsonContent
          : JSON.stringify(JSON.parse(jsonContent), null, 2)
        : typeof jsonContent === "string"
        ? jsonContent
        : JSON.stringify(JSON.parse(jsonContent));

      // Record this fetch
      recordUrlFetch(url, "json");

      return {
        content: [{ type: "text", text: formattedJson }],
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
    extractText: z.boolean().optional().describe("Whether to extract text content only (default: false)"),
  },
  async ({ url, extractText = false }) => {
    try {
      const response = await fetchUrl(url);
      const contentText = await response.text();
      const detectedType = detectContentType(response, url);

      let htmlContent;
      if (extractText) {
        const plainText = await convertToText(contentText, detectedType, url);
        htmlContent = `<pre>${escapeHtml(plainText)}</pre>`;
      } else {
        htmlContent = await convertToHtml(contentText, detectedType, url);
      }

      // Record this fetch
      recordUrlFetch(url, "html");

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
  },
  async ({ url }) => {
    try {
      const response = await fetchUrl(url);
      const contentText = await response.text();
      const detectedType = detectContentType(response, url);

      const markdownContent = await convertToMarkdown(contentText, detectedType, url);

      // Record this fetch
      recordUrlFetch(url, "markdown");

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
  },
  async ({ url }) => {
    try {
      const response = await fetchUrl(url);
      const contentText = await response.text();
      const detectedType = detectContentType(response, url);

      const textContent = await convertToText(contentText, detectedType, url);

      // Record this fetch
      recordUrlFetch(url, "text");

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
