# MCP URL Fetcher

A Model Context Protocol (MCP) server that enables LLMs to fetch and process web content in multiple formats.

## Overview

MCP URL Fetcher provides tools for retrieving content from the web in HTML, JSON, Markdown, and plain text formats. It's designed to work with any MCP-compatible client, including Claude for Desktop, enabling LLMs to access and analyze web content securely.

## Features

-   📄 **Multi-format Support**: Fetch content in HTML, JSON, Markdown, and plain text
-   🔍 **Automatic Content Detection**: Smart format detection based on HTTP headers and file extensions
-   🔧 **Format-specific Processing**:
    -   HTML content extraction
    -   JSON pretty-printing and path-based extraction
    -   Complete Markdown rendering
    -   Raw text retrieval
-   📜 **History Tracking**: Maintains logs of recently fetched URLs
-   📋 **Pre-built Prompts**: Ready-to-use templates for web content analysis
-   🛡️ **Robust Error Handling**: Comprehensive error handling for all operations

## Installation

### Prerequisites

-   Node.js 16.x or higher
-   npm or yarn

### Quick Start

1. Clone the repository:

    ```bash
    git clone https://github.com/yourusername/mcp-url-fetcher.git
    cd mcp-url-fetcher
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

## Integration with Claude for Desktop

1. Open your Claude for Desktop configuration file:

    - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
    - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the URL Fetcher server to your configuration:

    ```json
    {
        "mcpServers": {
            "url-fetcher": {
                "command": "node",
                "args": ["/absolute/path/to/mcp-url-fetcher/build/index.js"]
            }
        }
    }
    ```

3. Restart Claude for Desktop

## Available Tools

### `fetch`

Fetches content from a URL with automatic format detection.

**Parameters:**

-   `url` (string, required): The URL to fetch content from
-   `format` (string, optional): Format to fetch (`auto`, `html`, `json`, `markdown`, `text`). Default: `auto`

**Example:**

```
Can you fetch the content from https://example.com and tell me what it's about?
```

### `fetch-html`

Fetches HTML content from a URL.

**Parameters:**

-   `url` (string, required): The URL to fetch HTML from
-   `extractText` (boolean, optional): Whether to extract text content only. Default: `false`

**Example:**

```
Can you fetch the HTML structure of https://example.com?
```

### `fetch-json`

Fetches and parses JSON content from a URL.

**Parameters:**

-   `url` (string, required): The URL to fetch JSON from
-   `prettyPrint` (boolean, optional): Whether to pretty-print the JSON. Default: `true`
-   `path` (string, optional): JSONPath-like expression to extract specific data

**Example:**

```
Can you fetch the user data from https://api.example.com/users/1?
```

### `fetch-markdown`

Fetches Markdown content from a URL.

**Parameters:**

-   `url` (string, required): The URL to fetch Markdown from

**Example:**

```
Can you fetch and render the README from https://raw.githubusercontent.com/user/repo/main/README.md?
```

### `fetch-text`

Fetches plain text content from a URL.

**Parameters:**

-   `url` (string, required): The URL to fetch text from

**Example:**

```
Can you fetch the text content from https://example.com/robots.txt?
```

## Available Resources

### `recent-urls://list`

Returns a list of recently fetched URLs with timestamps and content types.

**Example:**

```
What URLs have I fetched recently?
```

## Available Prompts

### `fetch-website`

Template for fetching and analyzing website content.

**Parameters:**

-   `url` (string, required): URL of the website to fetch
-   `format` (string, optional): Format to fetch (`html` or `text`). Default: `text`

### `fetch-api`

Template for fetching and analyzing API data.

**Parameters:**

-   `url` (string, required): URL of the API endpoint
-   `path` (string, optional): JSON path to extract specific data

## Testing

You can test the server using the MCP Inspector:

```bash
npm run test
```

## Troubleshooting

### Common Issues

1. **Connection errors**: Verify that the URL is accessible and correctly formatted
2. **JSON parsing errors**: Confirm that the URL returns valid JSON
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
-   Powered by Node.js and TypeScript

---

Made with ❤️ for the MCP community
