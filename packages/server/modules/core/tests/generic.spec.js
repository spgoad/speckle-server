/* istanbul ignore file */
const expect = require('chai').expect

const { beforeEachContext } = require('@/test/hooks')
const { createStream } = require('@/modules/core/services/streams')
const { createUser } = require('@/modules/core/services/users')

const {
  validateServerRole,
  validateScopes,
  authorizeResolver
} = require('@/modules/shared')
const { buildContext } = require('@/modules/shared/middleware')
const { ForbiddenError } = require('apollo-server-express')

describe('Generic AuthN & AuthZ controller tests', () => {
  before(async () => {
    await beforeEachContext()
  })

  it('Validate scopes', async () => {
    await validateScopes()
      .then(() => {
        throw new Error('This should have been rejected')
      })
      .catch((err) =>
        expect('You do not have the required privileges.').to.equal(err.message)
      )

    await validateScopes(['a'], 'b')
      .then(() => {
        throw new Error('This should have been rejected')
      })
      .catch((err) =>
        expect('You do not have the required privileges.').to.equal(err.message)
      )

    await validateScopes(['a', 'b'], 'b') // should pass
  })
  ;[
    ['BS header', { req: { headers: { authorization: 'Bearer BS' } } }],
    ['Null header', { req: { headers: { authorization: null } } }],
    ['Undefined header', { req: { headers: { authorization: undefined } } }],
    ['BS token', { token: 'Bearer BS' }],
    ['Null token', { token: null }],
    ['Undefined token', { token: undefined }]
  ].map(([caseName, contextInput]) =>
    it(`Should create proper context ${caseName}`, async () => {
      const res = await buildContext(contextInput)
      expect(res.auth).to.equal(false)
    })
  )

  it('Should validate server role', async () => {
    await validateServerRole({ auth: true, role: 'server:user' }, 'server:admin')
      .then(() => {
        throw new Error('This should have been rejected')
      })
      .catch((err) =>
        expect('You do not have the required server role').to.equal(err.message)
      )

    await validateServerRole({ auth: true, role: 'HACZOR' }, '133TCR3w')
      .then(() => {
        throw new Error('This should have been rejected')
      })
      .catch((err) => expect('Invalid server role specified').to.equal(err.message))

    await validateServerRole({ auth: true, role: 'server:admin' }, '133TCR3w')
      .then(() => {
        throw new Error('This should have been rejected')
      })
      .catch((err) => expect('Invalid server role specified').to.equal(err.message))

    const test = await validateServerRole(
      { auth: true, role: 'server:admin' },
      'server:user'
    )
    expect(test).to.equal(true)
  })

  it('Resolver Authorization Should fail nicely when roles & resources are wanky', async () => {
    await authorizeResolver(null, 'foo', 'bar')
      .then(() => {
        throw new Error('This should have been rejected')
      })
      .catch((err) => expect('Unknown role: bar').to.equal(err.message))

    // this caught me out, but streams:read is not a valid role for now
    await authorizeResolver('foo', 'bar', 'streams:read')
      .then(() => {
        throw new Error('This should have been rejected')
      })
      .catch((err) => expect('Unknown role: streams:read').to.equal(err.message))
  })

  describe('Authorize resolver ', () => {
    const myStream = {
      name: 'My Stream 2',
      isPublic: true
    }
    const notMyStream = {
      name: 'Not My Stream 1',
      isPublic: false
    }
    const serverOwner = {
      name: 'Itsa Me',
      email: 'me@gmail.com',
      password: 'sn3aky-1337-b1m'
    }
    const otherGuy = {
      name: 'Some Other DUde',
      email: 'otherguy@gmail.com',
      password: 'sn3aky-1337-b1m'
    }

    before(async function () {
      // Seeding
      await Promise.all([
        createUser(serverOwner).then((id) => (serverOwner.id = id)),
        createUser(otherGuy).then((id) => (otherGuy.id = id))
      ])

      await Promise.all([
        createStream({ ...myStream, ownerId: serverOwner.id }).then(
          (id) => (myStream.id = id)
        ),
        createStream({ ...notMyStream, ownerId: otherGuy.id }).then(
          (id) => (notMyStream.id = id)
        )
      ])
    })

    afterEach(() => {
      process.env.ADMIN_OVERRIDE_ENABLED = 'false'
    })
    it('should allow stream:owners to be stream:owners', async () => {
      const role = await authorizeResolver(
        serverOwner.id,
        myStream.id,
        'stream:contributor'
      )
      expect(role).to.equal('stream:owner')
    })

    it('should get the passed in role for server:admins if override enabled', async () => {
      process.env.ADMIN_OVERRIDE_ENABLED = 'true'
      const role = await authorizeResolver(
        serverOwner.id,
        myStream.id,
        'stream:contributor'
      )
      expect(role).to.equal('stream:contributor')
    })

    it('should not allow server:admins to be anything if adminOverride is disabled', async () => {
      try {
        await authorizeResolver(serverOwner.id, notMyStream.id, 'stream:contributor')
        throw 'This should have thrown'
      } catch (e) {
        expect(e instanceof ForbiddenError)
      }
    })

    it('should allow server:admins to be anything if adminOverride is enabled', async () => {
      process.env.ADMIN_OVERRIDE_ENABLED = 'true'
      const role = await authorizeResolver(
        serverOwner.id,
        notMyStream.id,
        'stream:contributor'
      )
      expect(role).to.equal('stream:contributor')
    })

    it('should not allow server:users to be anything if adminOverride is disabled', async () => {
      try {
        await authorizeResolver(otherGuy.id, myStream.id, 'stream:contributor')
        throw 'This should have thrown'
      } catch (e) {
        expect(e instanceof ForbiddenError)
      }
    })

    it('should not allow server:users to be anything if adminOverride is enabled', async () => {
      process.env.ADMIN_OVERRIDE_ENABLED = 'true'
      try {
        await authorizeResolver(otherGuy.id, myStream.id, 'stream:contributor')
        throw 'This should have thrown'
      } catch (e) {
        expect(e instanceof ForbiddenError)
      }
    })
  })
})
