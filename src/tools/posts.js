/**
 * Post tools — list, get, create, update, delete, revisions.
 *
 * Update and delete auto-backup current state before applying changes.
 */

import { listSiteSlugs } from '../config.js';

const siteEnum = listSiteSlugs();

// Fields that WP accepts on create/update (allowlist for restore safety)
const WRITABLE_POST_FIELDS = [
  'title', 'content', 'excerpt', 'status', 'slug',
  'categories', 'tags', 'featured_media', 'comment_status',
  'ping_status', 'meta', 'sticky', 'template', 'format',
  'author', 'date', 'password',
];

/**
 * Filter a WP post object down to writable fields only.
 */
function filterWritableFields(post) {
  const filtered = {};
  for (const key of WRITABLE_POST_FIELDS) {
    if (post[key] !== undefined) {
      // WP returns title/content/excerpt as { raw, rendered } with context=edit
      // We want the raw value for faithful restore
      if (typeof post[key] === 'object' && post[key] !== null && 'raw' in post[key]) {
        filtered[key] = post[key].raw;
      } else {
        filtered[key] = post[key];
      }
    }
  }
  return filtered;
}

export const POST_TOOLS = [
  {
    name: 'wp_list_posts',
    description: 'List or search WordPress posts/pages. Returns titles, IDs, status, and dates.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        post_type: { type: 'string', description: 'Post type: "posts" or "pages" (default: "posts")' },
        status: { type: 'string', description: 'Filter by status: publish, draft, pending, private, trash, any (default: any)' },
        search: { type: 'string', description: 'Search query' },
        categories: { type: 'string', description: 'Comma-separated category IDs' },
        per_page: { type: 'number', description: 'Results per page (default: 20, max: 100)' },
        page: { type: 'number', description: 'Page number (default: 1)' },
      },
      required: ['site'],
    },
  },
  {
    name: 'wp_get_post',
    description: 'Get a single WordPress post or page by ID, including full content, meta, and taxonomy terms.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        id: { type: 'number', description: 'Post/page ID' },
        post_type: { type: 'string', description: 'Post type: "posts" or "pages" (default: "posts")' },
      },
      required: ['site', 'id'],
    },
  },
  {
    name: 'wp_list_revisions',
    description: 'List WordPress native revisions for a post or page.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        post_id: { type: 'number', description: 'Post/page ID' },
        post_type: { type: 'string', description: 'Post type: "posts" or "pages" (default: "posts")' },
      },
      required: ['site', 'post_id'],
    },
  },
  {
    name: 'wp_create_post',
    description: 'Create a new WordPress post or page. Defaults to draft status.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        post_type: { type: 'string', description: 'Post type: "posts" or "pages" (default: "posts")' },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML or Gutenberg blocks)' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        status: { type: 'string', description: 'Status: draft, publish, pending, private (default: draft)' },
        categories: { type: 'array', items: { type: 'number' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'number' }, description: 'Tag IDs' },
        featured_media: { type: 'number', description: 'Featured image media ID' },
      },
      required: ['site', 'title'],
    },
  },
  {
    name: 'wp_update_post',
    description: 'Update an existing WordPress post or page. Automatically backs up current state before applying changes.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        id: { type: 'number', description: 'Post/page ID to update' },
        post_type: { type: 'string', description: 'Post type: "posts" or "pages" (default: "posts")' },
        title: { type: 'string', description: 'New title' },
        content: { type: 'string', description: 'New content' },
        excerpt: { type: 'string', description: 'New excerpt' },
        status: { type: 'string', description: 'New status' },
        categories: { type: 'array', items: { type: 'number' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'number' }, description: 'Tag IDs' },
        featured_media: { type: 'number', description: 'Featured image media ID' },
        slug: { type: 'string', description: 'URL slug' },
      },
      required: ['site', 'id'],
    },
  },
  {
    name: 'wp_delete_post',
    description: 'Delete (trash) a WordPress post or page. Automatically backs up current state before deleting. Use force=true for permanent deletion.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        id: { type: 'number', description: 'Post/page ID to delete' },
        post_type: { type: 'string', description: 'Post type: "posts" or "pages" (default: "posts")' },
        force: { type: 'boolean', description: 'Permanently delete instead of trashing (default: false)' },
      },
      required: ['site', 'id'],
    },
  },
];

function resolvePostType(args) {
  return args.post_type || 'posts';
}

export async function handleListPosts(client, args) {
  const type = resolvePostType(args);
  const params = new URLSearchParams();
  params.set('per_page', String(Math.min(args.per_page || 20, 100)));
  params.set('page', String(args.page || 1));
  params.set('context', 'edit');
  if (args.status) params.set('status', args.status);
  else params.set('status', 'any');
  if (args.search) params.set('search', args.search);
  if (args.categories) params.set('categories', args.categories);

  const posts = await client.get(`/${type}?${params.toString()}`);

  // Return a summary for listing (not full content)
  const summary = posts.map(p => ({
    id: p.id,
    title: p.title?.raw || p.title?.rendered || p.title,
    status: p.status,
    date: p.date,
    modified: p.modified,
    slug: p.slug,
    link: p.link,
    author: p.author,
  }));

  return { count: summary.length, posts: summary };
}

export async function handleGetPost(client, args) {
  const type = resolvePostType(args);
  return client.get(`/${type}/${args.id}?context=edit`);
}

export async function handleListRevisions(client, args) {
  const type = resolvePostType(args);
  const revisions = await client.get(`/${type}/${args.post_id}/revisions`);
  return {
    post_id: args.post_id,
    count: revisions.length,
    revisions: revisions.map(r => ({
      id: r.id,
      date: r.date,
      author: r.author,
      title: r.title?.raw || r.title?.rendered || r.title,
      excerpt: r.excerpt?.raw ? r.excerpt.raw.substring(0, 200) : '',
    })),
  };
}

export async function handleCreatePost(client, args) {
  const type = resolvePostType(args);
  const body = {};
  for (const field of ['title', 'content', 'excerpt', 'status', 'categories', 'tags', 'featured_media']) {
    if (args[field] !== undefined) body[field] = args[field];
  }
  if (!body.status) body.status = 'draft';

  const created = await client.post(`/${type}`, body);
  return {
    id: created.id,
    title: created.title?.raw || created.title?.rendered,
    status: created.status,
    link: created.link,
    message: `Post created successfully (ID: ${created.id}, status: ${created.status})`,
  };
}

export async function handleUpdatePost(client, backupStore, args, userEmail, site) {
  const type = resolvePostType(args);
  const { id, ...updateFields } = args;
  delete updateFields.site;
  delete updateFields.post_type;

  // 1. Snapshot current state
  const current = await client.get(`/${type}/${id}?context=edit`);

  // 2. Store backup
  const changedFields = Object.keys(updateFields).filter(k => updateFields[k] !== undefined);
  const backupId = backupStore.createBackup({
    objectType: type === 'pages' ? 'page' : 'post',
    objectId: id,
    snapshot: current,
    action: 'update',
    changedBy: userEmail || 'unknown',
    changeSummary: `Updated fields: ${changedFields.join(', ')}`,
    wpSite: site,
  });

  // 3. Apply update
  const body = {};
  for (const field of WRITABLE_POST_FIELDS) {
    if (updateFields[field] !== undefined) body[field] = updateFields[field];
  }
  const updated = await client.post(`/${type}/${id}`, body);

  return {
    id: updated.id,
    title: updated.title?.raw || updated.title?.rendered,
    status: updated.status,
    link: updated.link,
    backup_id: backupId,
    message: `Post ${id} updated. Backup ID: ${backupId} (use wp_restore to revert)`,
  };
}

export async function handleDeletePost(client, backupStore, args, userEmail, site) {
  const type = resolvePostType(args);
  const { id } = args;

  // 1. Snapshot current state
  const current = await client.get(`/${type}/${id}?context=edit`);

  // 2. Store backup
  const backupId = backupStore.createBackup({
    objectType: type === 'pages' ? 'page' : 'post',
    objectId: id,
    snapshot: current,
    action: 'delete',
    changedBy: userEmail || 'unknown',
    changeSummary: `Deleted post "${current.title?.raw || current.title?.rendered || id}"${args.force ? ' (permanent)' : ' (trashed)'}`,
    wpSite: site,
  });

  // 3. Delete
  const forceParam = args.force ? '?force=true' : '';
  const result = await client.del(`/${type}/${id}${forceParam}`);

  return {
    id,
    action: args.force ? 'permanently deleted' : 'trashed',
    backup_id: backupId,
    message: `Post ${id} ${args.force ? 'permanently deleted' : 'moved to trash'}. Backup ID: ${backupId} (use wp_restore to revert)`,
  };
}

export { filterWritableFields, WRITABLE_POST_FIELDS };
