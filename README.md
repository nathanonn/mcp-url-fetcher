# MCP URL Format Converter

A Model Context Protocol (MCP) server that fetches content from any URL and converts it to your desired output format.

## Overview

MCP URL Format Converter provides tools for retrieving content from any web URL and transforming it into various formats (HTML, JSON, Markdown, or plain text), regardless of the original content type. It's designed to work with any MCP-compatible client, including Claude for Desktop, enabling LLMs to access, transform, and analyze web content in a consistent format.

## Features

-   🔄 **Format Conversion**: Transform any web content to HTML, JSON, Markdown, or plain text
-   🌐 **Universal Input Support**: Handle websites, APIs, raw files, and more
-   🔍 **Automatic Content Detection**: Intelligently identifies source format
-   🧰 **Robust Library Support**: Uses industry-standard libraries:
    -   Cheerio for HTML parsing
    -   Marked for Markdown processing
    -   Fast-XML-Parser for XML handling
    -   CSVtoJSON for CSV conversion
    -   SanitizeHTML for security
    -   Turndown for HTML-to-Markdown conversion
-   🔧 **Advanced Format Processing**:
    -   HTML parsing with metadata extraction
    -   JSON pretty-printing and structure preservation
    -   Markdown rendering with styling
    -   CSV-to-table conversion
    -   XML-to-JSON transformation
-   📜 **History Tracking**: Maintains logs of recently fetched URLs
-   🛡️ **Security Focus**: Content sanitization to prevent XSS attacks

## Installation

### Prerequisites

-   Node.js 16.x or higher
-   npm or yarn

### Quick Start

1. Clone the repository:

    ```bash
    git clone https://github.com/yourusername/mcp-url-converter.git
    cd mcp-url-converter
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Build the project:

    ```bash
    npm run build
    ```

4. Run the server:
    ```bash
    npm start
    ```

## Playwright Integration

This server uses Playwright for advanced web scraping capabilities:

### Key Features

-   **Dynamic Content Support**: Handles JavaScript-heavy websites and single-page applications
-   **Anti-Scraping Bypass**: Works with sites that block simple API requests
-   **Multiple Browser Engines**: Support for Chromium, Firefox, and WebKit
-   **Screenshot Capture**: Visual representation of web content
-   **Custom JavaScript**: Execute scripts within the page context for better extraction

### Browser Requirements

Playwright requires browser binaries to be installed. The `postinstall` script handles this automatically by running:

```bash
npx playwright install
```

You may need additional system dependencies depending on your OS. See [Playwright System Requirements](https://playwright.dev/docs/intro#system-requirements) for details.

### Example Usage

To explicitly use Playwright for content that requires JavaScript:

```
Can you fetch https://twitter.com/elonmusk and convert it to markdown, using Playwright?
```

To capture a screenshot of a website:

```
Can you take a screenshot of https://example.com?
```

To handle a site with dynamically loaded content:

```
Can you fetch https://example.com and convert it to JSON, waiting for the #main-content element to appear?
```

## Integration with Claude for Desktop

1. Open your Claude for Desktop configuration file:

    - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
    - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the URL converter server to your configuration:

    ```json
    {
        "mcpServers": {
            "url-converter": {
                "command": "node",
                "args": ["/absolute/path/to/mcp-url-converter/build/index.js"]
            }
        }
    }
    ```

3. Restart Claude for Desktop

## Available Tools

### `fetch`

Fetches content from any URL and automatically detects the best output format.

**Parameters:**

-   `url` (string, required): The URL to fetch content from
-   `format` (string, optional): Format to convert to (`auto`, `html`, `json`, `markdown`, `text`). Default: `auto`

**Example:**

```
Can you fetch https://example.com and choose the best format to display it?
```

### `fetch-json`

Fetches content from any URL and converts it to JSON format.

**Parameters:**

-   `url` (string, required): The URL to fetch content from
-   `prettyPrint` (boolean, optional): Whether to pretty-print the JSON. Default: `true`

**Example:**

```
Can you fetch https://example.com and convert it to JSON format?
```

### `fetch-html`

Fetches content from any URL and converts it to HTML format.

**Parameters:**

-   `url` (string, required): The URL to fetch content from
-   `extractText` (boolean, optional): Whether to extract text content only. Default: `false`

**Example:**

```
Can you fetch https://api.example.com/users and convert it to HTML?
```

### `fetch-markdown`

Fetches content from any URL and converts it to Markdown format.

**Parameters:**

-   `url` (string, required): The URL to fetch content from

**Example:**

```
Can you fetch https://example.com and convert it to Markdown?
```

### `fetch-text`

Fetches content from any URL and converts it to plain text format.

**Parameters:**

-   `url` (string, required): The URL to fetch content from

**Example:**

```
Can you fetch https://example.com and convert it to plain text?
```

### `web-search` and `deep-research`

These tools provide interfaces to Perplexity search capabilities (when supported by the MCP host).

## Available Resources

### `recent-urls://list`

Returns a list of recently fetched URLs with timestamps and output formats.

**Example:**

```
What URLs have I fetched recently?
```

## Security

This server implements several security measures:

-   HTML sanitization using `sanitize-html` to prevent XSS attacks
-   Content validation before processing
-   Error handling and safe defaults
-   Input parameter validation with Zod
-   Safe output encoding

## Testing

You can test the server using the MCP Inspector:

```bash
npm run test
```

## Troubleshooting

### Common Issues

1. **Connection errors**: Verify that the URL is accessible and correctly formatted
2. **Conversion errors**: Some complex content may not convert cleanly between formats
3. **Cross-origin issues**: Some websites may block requests from unknown sources

### Debug Mode

For additional debugging information, set the `DEBUG` environment variable:

```bash
DEBUG=mcp:* npm start
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

-   Built with the [Model Context Protocol](https://modelcontextprotocol.io/)
-   Uses modern, actively maintained libraries with security focus
-   Sanitization approach based on OWASP recommendations

---

Last updated: 29 March 2025
