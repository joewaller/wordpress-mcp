/**
 * Comment tools — list, get, create, update, delete, and find unanswered.
 *
 * Create and update auto-backup via backupStore for audit trail.
 */

import { listSiteSlugs } from '../config.js';

const siteEnum = listSiteSlugs();

function requirePositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function clampPagination(perPage, page) {
  const pp = Math.max(1, Math.min(Number(perPage) || 20, 100));
  const pg = Math.max(1, Number(page) || 1);
  return { perPage: pp, page: pg };
}

function summariseComment(c) {
  return {
    id: c.id,
    post: c.post,
    parent: c.parent,
    author: c.author,
    author_name: c.author_name,
    date: c.date,
    status: c.status,
    content: c.content?.raw || c.content?.rendered || c.content,
    link: c.link,
  };
}

export const COMMENT_TOOLS = [
  {
    name: 'wp_list_comments',
    description: 'List WordPress comments with filters. Returns comment ID, author, content, status, and parent.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        post_id: { type: 'number', description: 'Filter by post ID' },
        status: { type: 'string', description: 'Filter by status: approve, hold, spam, trash (default: approve)' },
        parent: { type: 'number', description: 'Filter by parent comment ID (0 for top-level)' },
        per_page: { type: 'number', description: 'Results per page (default: 20, max: 100)' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        order: { type: 'string', description: 'Sort order: asc or desc (default: desc)' },
        orderby: { type: 'string', description: 'Sort field: date, id, parent (default: date)' },
        search: { type: 'string', description: 'Search query' },
        after: { type: 'string', description: 'ISO 8601 date — only comments after this date' },
        before: { type: 'string', description: 'ISO 8601 date — only comments before this date' },
      },
      required: ['site'],
    },
  },
  {
    name: 'wp_get_comment',
    description: 'Get a single WordPress comment by ID with full detail.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        id: { type: 'number', description: 'Comment ID' },
      },
      required: ['site', 'id'],
    },
  },
  {
    name: 'wp_create_comment',
    description: 'Create a WordPress comment (typically a reply). Auto-logs to audit trail.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        post: { type: 'number', description: 'Post ID to comment on' },
        parent: { type: 'number', description: 'Parent comment ID (for replies)' },
        content: { type: 'string', description: 'Comment content (HTML)' },
        author_name: { type: 'string', description: 'Author display name (optional — uses authenticated user if omitted)' },
        author_email: { type: 'string', description: 'Author email (optional — uses authenticated user if omitted)' },
        status: { type: 'string', description: 'Comment status: approve, hold (default: approve)' },
      },
      required: ['site', 'post', 'content'],
    },
  },
  {
    name: 'wp_update_comment',
    description: 'Update an existing WordPress comment. Auto-backs up current state before applying changes.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        id: { type: 'number', description: 'Comment ID to update' },
        content: { type: 'string', description: 'New comment content' },
        status: { type: 'string', description: 'New status: approve, hold, spam, trash' },
      },
      required: ['site', 'id'],
    },
  },
  {
    name: 'wp_delete_comment',
    description: 'Delete (trash) a WordPress comment. Auto-backs up current state. Use force=true for permanent deletion.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        id: { type: 'number', description: 'Comment ID to delete' },
        force: { type: 'boolean', description: 'Permanently delete instead of trashing (default: false)' },
      },
      required: ['site', 'id'],
    },
  },
  {
    name: 'wp_list_unanswered_comments',
    description: 'List top-level approved comments that have no replies. Useful for finding customer questions that need a response. Returns comments with post context.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: siteEnum, description: 'Target WordPress site' },
        per_page: { type: 'number', description: 'Max comments to check (default: 20, max: 100)' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        after: { type: 'string', description: 'ISO 8601 date — only comments after this date' },
        before: { type: 'string', description: 'ISO 8601 date — only comments before this date' },
      },
      required: ['site'],
    },
  },
];

export async function handleListComments(client, args) {
  const { perPage, page } = clampPagination(args.per_page, args.page);
  const params = new URLSearchParams();
  params.set('per_page', String(perPage));
  params.set('page', String(page));
  params.set('context', 'edit');
  if (args.post_id) params.set('post', String(args.post_id));
  if (args.status) params.set('status', args.status);
  if (args.parent !== undefined) params.set('parent', String(args.parent));
  if (args.order) params.set('order', args.order);
  if (args.orderby) params.set('orderby', args.orderby);
  if (args.search) params.set('search', args.search);
  if (args.after) params.set('after', args.after);
  if (args.before) params.set('before', args.before);

  const comments = await client.get(`/comments?${params.toString()}`);
  const summary = comments.map(summariseComment);

  return { count: summary.length, comments: summary };
}

export async function handleGetComment(client, args) {
  const id = requirePositiveInt(args.id, 'id');
  return client.get(`/comments/${id}?context=edit`);
}

export async function handleCreateComment(client, backupStore, args, userEmail, site) {
  const body = {};
  if (args.post) body.post = args.post;
  if (args.parent) body.parent = args.parent;
  if (args.content) body.content = args.content;
  if (args.author_name) body.author_name = args.author_name;
  if (args.author_email) body.author_email = args.author_email;
  if (args.status) body.status = args.status;

  const created = await client.post('/comments', body);

  // Audit trail
  const backupId = backupStore.createBackup({
    objectType: 'comment',
    objectId: created.id,
    snapshot: created,
    action: 'create',
    changedBy: userEmail || 'unknown',
    changeSummary: `Created comment on post ${created.post}${created.parent ? ` (reply to comment ${created.parent})` : ''} — status: ${created.status}`,
    wpSite: site,
  });

  return {
    id: created.id,
    post: created.post,
    parent: created.parent,
    status: created.status,
    content: created.content?.raw || created.content?.rendered || created.content,
    backup_id: backupId,
    message: `Comment created (ID: ${created.id}, post: ${created.post}, status: ${created.status})`,
  };
}

export async function handleUpdateComment(client, backupStore, args, userEmail, site) {
  const id = requirePositiveInt(args.id, 'id');

  // 1. Snapshot current state
  const current = await client.get(`/comments/${id}?context=edit`);

  // 2. Store backup
  const changedFields = Object.keys(args).filter(k => !['site', 'id'].includes(k) && args[k] !== undefined);
  const backupId = backupStore.createBackup({
    objectType: 'comment',
    objectId: id,
    snapshot: current,
    action: 'update',
    changedBy: userEmail || 'unknown',
    changeSummary: `Updated comment ${id} fields: ${changedFields.join(', ')}`,
    wpSite: site,
  });

  // 3. Apply update
  const body = {};
  if (args.content !== undefined) body.content = args.content;
  if (args.status !== undefined) body.status = args.status;
  const updated = await client.post(`/comments/${id}`, body);

  return {
    id: updated.id,
    post: updated.post,
    status: updated.status,
    content: updated.content?.raw || updated.content?.rendered || updated.content,
    backup_id: backupId,
    message: `Comment ${id} updated. Backup ID: ${backupId} (use wp_restore to revert)`,
  };
}

export async function handleDeleteComment(client, backupStore, args, userEmail, site) {
  const id = requirePositiveInt(args.id, 'id');

  // 1. Snapshot current state
  const current = await client.get(`/comments/${id}?context=edit`);

  // 2. Store backup
  const backupId = backupStore.createBackup({
    objectType: 'comment',
    objectId: id,
    snapshot: current,
    action: 'delete',
    changedBy: userEmail || 'unknown',
    changeSummary: `Deleted comment ${id}${args.force ? ' (permanent)' : ' (trashed)'}`,
    wpSite: site,
  });

  // 3. Delete
  const forceParam = args.force ? '?force=true' : '';
  const result = await client.del(`/comments/${id}${forceParam}`);

  return {
    id,
    action: args.force ? 'permanently deleted' : 'trashed',
    backup_id: backupId,
    message: `Comment ${id} ${args.force ? 'permanently deleted' : 'moved to trash'}. Backup ID: ${backupId}`,
  };
}

export async function handleListUnansweredComments(client, args) {
  const { perPage, page } = clampPagination(args.per_page, args.page);

  // 1. Fetch top-level approved comments (parent=0)
  const topLevelParams = new URLSearchParams();
  topLevelParams.set('parent', '0');
  topLevelParams.set('status', 'approve');
  topLevelParams.set('per_page', String(perPage));
  topLevelParams.set('page', String(page));
  topLevelParams.set('order', 'asc');
  topLevelParams.set('orderby', 'date');
  topLevelParams.set('context', 'edit');
  if (args.after) topLevelParams.set('after', args.after);
  if (args.before) topLevelParams.set('before', args.before);

  const topLevel = await client.get(`/comments?${topLevelParams.toString()}`);

  if (topLevel.length === 0) {
    return { count: 0, unanswered_comments: [] };
  }

  // 2. For each top-level comment, check if it has any replies
  //    Batch by fetching replies for the post IDs we care about
  const postIds = [...new Set(topLevel.map(c => c.post))];
  const repliesByParent = {};

  // Fetch replies in batches per post (more efficient than per-comment)
  for (const postId of postIds) {
    const replyParams = new URLSearchParams();
    replyParams.set('post', String(postId));
    replyParams.set('parent_exclude', '0');  // only replies (parent != 0)
    replyParams.set('per_page', '100');
    replyParams.set('status', 'approve');

    try {
      const replies = await client.get(`/comments?${replyParams.toString()}`);
      for (const reply of replies) {
        if (!repliesByParent[reply.parent]) {
          repliesByParent[reply.parent] = [];
        }
        repliesByParent[reply.parent].push(reply);
      }
    } catch {
      // If fetching replies fails for a post, treat all its comments as unanswered
    }
  }

  // 3. Filter to only unanswered top-level comments
  const unanswered = topLevel.filter(c => !repliesByParent[c.id]);

  // 4. Enrich with post context (title + link)
  const postCache = {};
  const enriched = [];

  for (const comment of unanswered) {
    let postContext = postCache[comment.post];
    if (!postContext) {
      try {
        const post = await client.get(`/posts/${comment.post}?_fields=id,title,link,slug`);
        postContext = {
          post_id: post.id,
          post_title: post.title?.raw || post.title?.rendered || post.title,
          post_link: post.link,
          post_slug: post.slug,
        };
      } catch {
        postContext = { post_id: comment.post, post_title: '(unknown)', post_link: null, post_slug: null };
      }
      postCache[comment.post] = postContext;
    }

    enriched.push({
      ...summariseComment(comment),
      post_context: postContext,
    });
  }

  return {
    count: enriched.length,
    total_top_level_checked: topLevel.length,
    unanswered_comments: enriched,
  };
}
