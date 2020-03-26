'use strict'
const root = require( 'app-root-path' )
const { getStreams, getStream, createStream, updateStream } = require( './controllers/streams' )
const { authenticate, authorize, announce } = require( `${root}/modules/shared` )

const streams = require( 'express' ).Router( { mergeParams: true } )

streams.get( '/streams', authenticate, getStreams )

streams.get( '/streams/:streamId', authenticate, authorize, getStream )

streams.post( '/streams', authenticate, authorize, createStream, announce )

streams.put( '/streams/:streamId', authenticate, authorize, updateStream, announce )

module.exports = streams