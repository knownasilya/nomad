// Explicit `.ts` import specifiers: this module is imported by scripts/gen-schema-dts.mjs
// through Node's --experimental-strip-types loader, which (unlike Vite/tsc bundler resolution)
// does NOT rewrite a `.js` specifier to its `.ts` sibling. Keep the extensions as `.ts` here.
import { PersonSchema, type Person } from './person.ts';
import { PostSchema, type Post } from './post.ts';
import { FeedSchema, type Feed } from './feed.ts';
import { BookmarkSchema, type Bookmark } from './bookmark.ts';
import { CommentSchema, type Comment } from './comment.ts';
import { FollowsSchema, type Follows } from './follows.ts';
import { ReactionSchema, type Reaction } from './reaction.ts';
import { StatusSchema, type Status } from './status.ts';
import { VoteSchema, type Vote } from './vote.ts';

export {
  PersonSchema,
  PostSchema,
  FeedSchema,
  BookmarkSchema,
  CommentSchema,
  FollowsSchema,
  ReactionSchema,
  StatusSchema,
  VoteSchema,
};

export type { Person, Post, Feed, Bookmark, Comment, Follows, Reaction, Status, Vote };

export const SCHEMAS = {
  'walled.garden/person': PersonSchema,
  'walled.garden/post': PostSchema,
  'walled.garden/feed': FeedSchema,
  'walled.garden/bookmark': BookmarkSchema,
  'walled.garden/comment': CommentSchema,
  'walled.garden/follows': FollowsSchema,
  'walled.garden/reaction': ReactionSchema,
  'walled.garden/status': StatusSchema,
  'walled.garden/vote': VoteSchema,
} as const;

// The set of registered walled.garden `type` strings (e.g. 'walled.garden/post').
export type SchemaType = keyof typeof SCHEMAS;

// The discriminated union of every walled.garden record shape.
export type WalledGardenRecord =
  | Person
  | Post
  | Feed
  | Bookmark
  | Comment
  | Follows
  | Reaction
  | Status
  | Vote;
