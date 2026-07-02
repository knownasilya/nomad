import { PersonSchema } from './person.js'
import { PostSchema } from './post.js'
import { FeedSchema } from './feed.js'
import { BookmarkSchema } from './bookmark.js'
import { CommentSchema } from './comment.js'
import { FollowsSchema } from './follows.js'
import { ReactionSchema } from './reaction.js'
import { StatusSchema } from './status.js'
import { VoteSchema } from './vote.js'

export {
  PersonSchema,
  PostSchema,
  FeedSchema,
  BookmarkSchema,
  CommentSchema,
  FollowsSchema,
  ReactionSchema,
  StatusSchema,
  VoteSchema
}

export const SCHEMAS = {
  'walled.garden/person': PersonSchema,
  'walled.garden/post': PostSchema,
  'walled.garden/feed': FeedSchema,
  'walled.garden/bookmark': BookmarkSchema,
  'walled.garden/comment': CommentSchema,
  'walled.garden/follows': FollowsSchema,
  'walled.garden/reaction': ReactionSchema,
  'walled.garden/status': StatusSchema,
  'walled.garden/vote': VoteSchema
}
