/**
 * WordPress REST API client.
 *
 * Wraps fetch with Basic Auth (Application Passwords), retry on 429,
 * and optional path prefix for multisite subdirectory installs.
 */

export class WordPressClient {
  /**
   * @param {string} baseUrl - Site base URL (e.g. "https://qa1.finder.com.au")
   * @param {string} username - WordPress username
   * @param {string} appPassword - Application Password
   * @param {object} [options]
   * @param {string} [options.pathPrefix] - Path prefix for multisite subdirectory installs
   */
  constructor(baseUrl, username, appPassword, options = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authHeader = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
    this.pathPrefix = options.pathPrefix || '';
  }

  /**
   * Make a request to the WP REST API.
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint (e.g. "/posts/123")
   * @param {object|null} [body] - Request body (JSON-serialisable)
   * @param {object} [extraHeaders] - Additional headers
   * @returns {Promise<object>} Parsed JSON response
   */
  async request(method, endpoint, body = null, extraHeaders = {}) {
    const url = `${this.baseUrl}${this.pathPrefix}/wp-json/wp/v2${endpoint}`;

    const headers = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
      ...extraHeaders,
    };

    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    const options = { method, headers };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    let response;
    let retries = 0;
    const maxRetries = 2;

    while (true) {
      response = await fetch(url, options);

      // Retry on 429 with backoff
      if (response.status === 429 && retries < maxRetries) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        retries++;
        continue;
      }
      break;
    }

    if (!response.ok) {
      const text = await response.text();
      let detail = text;
      try {
        const json = JSON.parse(text);
        detail = json.message || text;
      } catch { /* use raw text */ }
      throw new Error(`WordPress API ${method} ${endpoint} → ${response.status}: ${detail}`);
    }

    // DELETE with force=true returns the deleted object; some endpoints return 204
    if (response.status === 204) {
      return { deleted: true };
    }

    return response.json();
  }

  async get(endpoint) {
    return this.request('GET', endpoint);
  }

  async post(endpoint, body) {
    return this.request('POST', endpoint, body);
  }

  async del(endpoint) {
    return this.request('DELETE', endpoint);
  }

  /**
   * Upload media via multipart form data.
   * @param {Buffer} fileBuffer - File content
   * @param {string} filename - Original filename
   * @param {string} contentType - MIME type
   * @param {object} [meta] - Additional fields (title, alt_text, caption)
   * @returns {Promise<object>}
   */
  async uploadMedia(fileBuffer, filename, contentType, meta = {}) {
    const url = `${this.baseUrl}${this.pathPrefix}/wp-json/wp/v2/media`;

    const boundary = '----WPMCPBoundary' + Date.now();
    const parts = [];

    // File part
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    );
    parts.push(fileBuffer);
    parts.push('\r\n');

    // Meta fields
    for (const [key, value] of Object.entries(meta)) {
      if (value !== undefined && value !== null) {
        parts.push(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${value}\r\n`
        );
      }
    }

    parts.push(`--${boundary}--\r\n`);

    // Combine into a single Buffer
    const bodyParts = parts.map(p => typeof p === 'string' ? Buffer.from(p) : p);
    const body = Buffer.concat(bodyParts);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WordPress media upload → ${response.status}: ${text}`);
    }

    return response.json();
  }
}
