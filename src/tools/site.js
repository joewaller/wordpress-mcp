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
  // /wp/v2/settings requires admin; the REST API index gives site info without elevated permissions
  const data = await client.getSiteIndex();

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
