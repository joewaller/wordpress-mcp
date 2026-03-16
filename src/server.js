/**
 * WordPress MCP Server
 *
 * Wraps the WordPress REST API with backup-before-change and multi-site support.
 * Designed for deployment on the MCP gateway for multi-user access.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { extractGatewayContext } from './shared/gateway-credentials.js';
import { getSiteConfig, getSiteCredentials, getDefaultCredentials } from './config.js';
import { WordPressClient } from './wordpress-client.js';
import { BackupStore } from './backup-store.js';
import { TOOLS, handleToolCall } from './tools/index.js';

class WordPressMCPServer {
  constructor() {
    this.server = new Server(
      { name: 'wordpress', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.backupStore = new BackupStore();
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Extract per-user credentials (overlays env defaults)
        const { credentials, userEmail, cleanArgs } = extractGatewayContext(
          args || {},
          getDefaultCredentials()
        );

        // Resolve site — required for most tools, optional for wp_list_changes and wp_restore
        const site = cleanArgs.site;
        let client = null;
        let siteConfig = null;

        // wp_restore and wp_list_changes can work without a site param
        // (wp_restore reads it from the backup record)
        const siteOptionalTools = ['wp_list_changes', 'wp_restore'];

        if (site) {
          siteConfig = getSiteConfig(site);
          const siteCreds = getSiteCredentials(site, credentials);
          client = new WordPressClient(
            siteConfig.baseUrl,
            siteCreds.user,
            siteCreds.appPassword,
            { pathPrefix: siteConfig.pathPrefix || '' }
          );
        } else if (!siteOptionalTools.includes(name)) {
          throw new Error('site parameter is required');
        }

        // For wp_restore without explicit site, build client from the backup's stored site
        if (name === 'wp_restore' && !client) {
          const backup = this.backupStore.getBackup(cleanArgs.backup_id);
          if (!backup) throw new Error(`Backup ${cleanArgs.backup_id} not found`);
          const backupSite = backup.wp_site;
          siteConfig = getSiteConfig(backupSite);
          const siteCreds = getSiteCredentials(backupSite, credentials);
          client = new WordPressClient(
            siteConfig.baseUrl,
            siteCreds.user,
            siteCreds.appPassword,
            { pathPrefix: siteConfig.pathPrefix || '' }
          );
        }

        return await handleToolCall(name, cleanArgs, client, this.backupStore, userEmail, site, siteConfig);
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('WordPress MCP server running on stdio');
  }
}

new WordPressMCPServer().run().catch(e => {
  console.error('Failed to start WordPress MCP server:', e);
  process.exit(1);
});
