/**
 * Site tools — site info, health check.
 */

import { listSiteSlugs } from '../config.js';

const siteEnum = listSiteSlugs();

export const SITE_TOOLS = [
  {
    name: 'wp_get_site_info',
    description: 'Get WordPress site information including name, URL, description, and REST API status. Useful for verifying connectivity.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
      },
      required: ['site'],
    },
  },
];

export async function handleGetSiteInfo(client, siteSlug, siteConfig) {
  // /wp/v2/settings requires admin; fall back to index endpoint
  // The WP REST API root gives us site info without elevated permissions
  const baseUrl = client.baseUrl + client.pathPrefix;
  const response = await fetch(`${baseUrl}/wp-json`, {
    headers: {
      'Authorization': client.authHeader,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch site info: ${response.status}`);
  }

  const data = await response.json();

  return {
    site: siteSlug,
    name: data.name,
    description: data.description,
    url: data.url,
    home: data.home,
    gmt_offset: data.gmt_offset,
    timezone_string: data.timezone_string,
    namespaces: data.namespaces,
    authentication: data.authentication ? Object.keys(data.authentication) : [],
    multisite: siteConfig.multisite,
  };
}
