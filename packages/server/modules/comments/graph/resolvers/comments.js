const appRoot = require('app-root-path')
const { authorizeResolver, pubsub } = require(`${appRoot}/modules/shared`)
const { ForbiddenError, ApolloError, withFilter } = require('apollo-server-express')
const { getStream } = require(`${appRoot}/modules/core/services/streams`)

const { getComment, getComments, createComment, createCommentReply, viewComment, archiveComment, editComment } = require(`${appRoot}/modules/comments/services`)

const authorizeStreamAccess = async ({ streamId, userId, auth }) => {
  const stream = await getStream({ streamId, userId })
  if (!stream)
    throw new ApolloError('Stream not found')

  if (!stream.isPublic && auth === false)
    throw new ForbiddenError('You are not authorized.')

  if (!stream.isPublic) {
    await authorizeResolver(userId, streamId, 'stream:reviewer')
  }
}

module.exports = {
  Query: {
    async comment(parent, args, context) {
      await authorizeStreamAccess({ streamId: args.streamId, userId: context.userId, auth: context.auth })
      let comment = await getComment({ id: args.id, userId: context.userId })
      if (comment.streamId !== args.streamId)
        throw new ForbiddenError('You do not have access to this comment.')
      return comment
    },

    async comments(parent, args, context) {
      await authorizeStreamAccess({ streamId: args.streamId, userId: context.userId, auth: context.auth })
      return { ...await getComments({ ...args, userId: context.userId }) }
    }
  },
  Comment: {
    async replies(parent, args) {
      const resources = [{ resourceId: parent.id, resourceType: 'comment' }]
      return await getComments({ resources, limit: args.limit, cursor: args.cursor })
    }
  },
  Mutation: {
    // Used for broadcasting real time chat head bubbles and status. Does not persist anything!
    async userViewerActivityBroadcast(parent, args, context) {
      await authorizeStreamAccess({ streamId: args.streamId, userId: context.userId, auth: context.auth })

      await pubsub.publish('VIEWER_ACTIVITY', {
        userViewerActivity: args.data,
        streamId: args.streamId,
        resourceId: args.resourceId
      })
      return true
    },

    async commentCreate(parent, args, context) {
      await authorizeResolver(context.userId, args.input.streamId, 'stream:reviewer')

      let id = await createComment({ userId: context.userId, input: args.input })

      await pubsub.publish('COMMENT_ACTIVITY', {
        commentActivity: { ...args.input, authorId: context.userId, id, replies: { totalCount: 0 }, updatedAt: Date.now(), createdAt: Date.now(), eventType: 'comment-added' },
        streamId: args.input.streamId,
        resourceId: args.input.resources[1].resourceId // TODO: hack for now
      })
      return id
    },

    async commentEdit(parent, args, context) {
      // TODO
      await editComment({ userId: context.userId, input: args.input })
    },

    // used for flagging a comment as viewed
    async commentView(parent, args, context) {
      await authorizeResolver(context.userId, args.streamId, 'stream:reviewer')
      await viewComment({ userId: context.userId, commentId: args.commentId })
      return true
    },

    async commentArchive(parent, args, context) {
      await authorizeStreamAccess({ streamId: args.streamId, userId: context.userId, auth: context.auth })
      await archiveComment({ ...args })
      await pubsub.publish('COMMENT_THREAD_ACTIVITY', {
        commentThreadActivity: { eventType: args.archived ? 'comment-archived' : 'comment-added' },
        streamId: args.streamId,
        commentId: args.commentId
      })
      return true
    },

    async commentReply(parent, args, context) {
      await authorizeResolver(context.userId, args.input.streamId, 'stream:reviewer')

      let id = await createCommentReply({ authorId: context.userId, parentCommentId: args.input.parentComment, streamId: args.input.streamId, text: args.input.text, data: args.input.data })

      await pubsub.publish('COMMENT_THREAD_ACTIVITY', {
        commentThreadActivity: { eventType: 'reply-added', ...args.input, id, authorId: context.userId, updatedAt: Date.now(), createdAt: Date.now() },
        streamId: args.input.streamId,
        commentId: args.input.parentComment
      })
      return id
    }
  },
  Subscription: {
    userViewerActivity: {
      subscribe: withFilter(() => pubsub.asyncIterator(['VIEWER_ACTIVITY']), async (payload, variables, context) => {
        await authorizeResolver(context.userId, payload.streamId, 'stream:reviewer')
        return payload.streamId === variables.streamId && payload.resourceId === variables.resourceId
      })
    },
    commentActivity: {
      subscribe: withFilter(() => pubsub.asyncIterator(['COMMENT_ACTIVITY']), async (payload, variables, context) => {
        await authorizeResolver(context.userId, payload.streamId, 'stream:reviewer')
        return payload.streamId === variables.streamId && payload.resourceId === variables.resourceId
      })
    },
    commentThreadActivity: {
      subscribe: withFilter(() => pubsub.asyncIterator(['COMMENT_THREAD_ACTIVITY']), async (payload, variables, context) => {
        await authorizeResolver(context.userId, payload.streamId, 'stream:reviewer')
        return payload.streamId === variables.streamId && payload.commentId === variables.commentId
      })
    }
  }
}