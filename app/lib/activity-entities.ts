/**
 * What the audit trail can be about and do. A plain module (no database imports) so
 * the audit page can use the lists in the browser without shipping the whole schema.
 */
export const ACTIVITY_ENTITIES = ["transaksi", "customer", "salesman", "user", "template"] as const;
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];

export const ACTIVITY_ACTIONS = ["create", "update", "delete", "restore"] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** The records that have an edit panel, and so a comment thread (templates have none). */
export const COMMENT_ENTITIES = ["transaksi", "customer", "salesman", "user"] as const;
export type CommentEntity = (typeof COMMENT_ENTITIES)[number];
