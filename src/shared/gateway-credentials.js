/**
 * Gateway Credential Extraction Helper
 *
 * Extracts per-user credentials injected by the MCP Gateway from tool call arguments.
 * The gateway injects two special fields into every tool call:
 *   - _gateway_user_email: The authenticated user's email (from IAP header)
 *   - _gateway_user_credentials: Per-user credential overrides (from whitelist-manager)
 *
 * Per-user credentials override group/default credentials when present.
 * The clean args (with gateway fields removed) are returned for normal tool processing.
 *
 * Usage:
 *   import { extractGatewayContext } from '../shared/gateway-credentials.js';
 *
 *   const { credentials, userEmail, cleanArgs } = extractGatewayContext(args, {
 *     WP_FINDER_COM_AU_QA1_USER: process.env.WP_FINDER_COM_AU_QA1_USER,
 *   });
 */

/**
 * Extract gateway-injected context from tool call arguments.
 *
 * @param {object} args - Raw tool call arguments (may contain _gateway_* fields)
 * @param {object} defaultCredentials - Default/group credentials keyed by env var name
 * @returns {{ credentials: object, userEmail: string|null, cleanArgs: object }}
 */
export function extractGatewayContext(args, defaultCredentials = {}) {
  const userEmail = args?._gateway_user_email || null;
  const userCreds = args?._gateway_user_credentials || {};

  // Start with defaults, overlay per-user credentials where present
  const credentials = { ...defaultCredentials };
  for (const [key, value] of Object.entries(userCreds)) {
    if (value) {
      credentials[key] = value;
    }
  }

  // Remove gateway fields from args so tool handlers get clean input
  const cleanArgs = { ...args };
  delete cleanArgs._gateway_user_email;
  delete cleanArgs._gateway_user_credentials;

  return { credentials, userEmail, cleanArgs };
}
