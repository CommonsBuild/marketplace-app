const TokenManager = artifacts.require('TokenManager')
const MiniMeToken = artifacts.require('MiniMeToken')
const Controller = artifacts.require('MarketplaceController')
const Hatch = artifacts.require('HatchMock')
const Formula = artifacts.require('BancorFormula')
const Agent = artifacts.require('Agent')
const Vault = artifacts.require('Vault')
const TokenMock = artifacts.require('TokenMock')

const {
  ZERO_ADDRESS,
  ETH,
  INITIAL_COLLATERAL_BALANCE,
  HATCH_GOAL,
  HATCH_PERIOD,
  HATCH_EXCHANGE_RATE,
  VESTING_CLIFF_PERIOD,
  VESTING_COMPLETE_PERIOD,
  PERCENT_SUPPLY_OFFERED,
  PERCENT_FUNDING_FOR_BENEFICIARY,
} = require('@1hive/apps-marketplace-shared-test-helpers/constants')

const { newDao, installNewApp } = require('@aragon/contract-helpers-test/src/aragon-os')

const { hash } = require('eth-ens-namehash')

const setup = {
  ids: {
    controller: hash('marketplace-controller.aragonpm.eth'),
    tokenManager: hash('token-manager.aragonpm.eth'),
    hatch: hash('hatch.aragonpm.eth'),
    agent: hash('agent.aragonpm.eth'),
    vault: hash('vault.aragonpm.eth'),
  },
  deploy: {
    base: async ctx => {
      ctx.base = ctx.base || {}

      ctx.base.controller = await Controller.new()
      ctx.base.tokenManager = await TokenManager.new()
      ctx.base.hatch = await Hatch.new()
      ctx.base.reserve = await Agent.new()
      ctx.base.vault = await Vault.new()
    },
    formula: async ctx => {
      ctx.formula = await Formula.new()
    },
    token: async (ctx, root) => {
      ctx.token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Bond', 18, 'BON', false, { from: root })
    },
    collaterals: async (ctx, user) => {
      ctx.collaterals = ctx.collaterals || {}
      ctx.collaterals.dai = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Test', 0, 'TST', true)
      ctx.collaterals.dai.generateTokens(user, INITIAL_COLLATERAL_BALANCE)
      ctx.collaterals.ant = await TokenMock.new(user, INITIAL_COLLATERAL_BALANCE)
    },
    dao: async (ctx, root) => {
      const { dao, acl } = await newDao(root)

      ctx.dao = dao
      ctx.acl = acl
    },
    infrastructure: async ctx => {
      ctx.roles = ctx.roles || {}

      await setup.deploy.base(ctx)
      await setup.deploy.formula(ctx)
    },
    organization: async (ctx, root, user) => {
      await setup.deploy.token(ctx, root)
      await setup.deploy.collaterals(ctx, user)
      await setup.deploy.dao(ctx, root)
      await setup.install.all(ctx, root)
      await setup.initialize.all(ctx, root, user)
      await setup.setPermissions.all(ctx, root, user)
      await setup.setCollaterals(ctx, root, user)
    },
  },
  install: {
    controller: async (ctx, root) => {
      ctx.controller = await Controller.at(await installNewApp(ctx.dao, setup.ids.controller, ctx.base.controller.address, root))
    },
    tokenManager: async (ctx, root) => {
      ctx.tokenManager = await TokenManager.at(await installNewApp(ctx.dao, setup.ids.tokenManager, ctx.base.tokenManager.address, root))
    },
    hatch: async (ctx, root) => {
      ctx.hatch = await Hatch.at(await installNewApp(ctx.dao, setup.ids.hatch, ctx.base.hatch.address, root))
    },
    reserve: async (ctx, root) => {
      ctx.reserve = await Agent.at(await installNewApp(ctx.dao, setup.ids.agent, ctx.base.reserve.address, root))
    },
    vault: async (ctx, root) => {
      ctx.vault = await Vault.at(await installNewApp(ctx.dao, setup.ids.vault, ctx.base.vault.address, root))
    },

    all: async (ctx, root) => {
      await setup.install.controller(ctx, root)
      await setup.install.tokenManager(ctx, root)
      await setup.install.hatch(ctx, root)
      await setup.install.reserve(ctx, root)
      await setup.install.vault(ctx, root)
    },
  },
  initialize: {
    controller: async (ctx, root) => {
      await ctx.controller.initialize(ctx.hatch.address, {
        from: root,
      })
    },
    tokenManager: async (ctx, root) => {
      await ctx.token.changeController(ctx.tokenManager.address, { from: root })
      await ctx.tokenManager.initialize(ctx.token.address, true, 0, { from: root })
    },
    hatch: async (ctx, root) => {
      await ctx.hatch.initialize(
        ctx.controller.address,
        ctx.tokenManager.address,
        ctx.reserve.address,
        ctx.vault.address,
        ctx.collaterals.dai.address,
        HATCH_GOAL,
        HATCH_PERIOD,
        HATCH_EXCHANGE_RATE,
        VESTING_CLIFF_PERIOD,
        VESTING_COMPLETE_PERIOD,
        PERCENT_SUPPLY_OFFERED,
        PERCENT_FUNDING_FOR_BENEFICIARY,
        0,
        { from: root }
      )
    },
    reserve: async (ctx, root) => {
      await ctx.reserve.initialize({ from: root })
    },
    vault: async (ctx, root) => {
      await ctx.vault.initialize({ from: root })
    },
    all: async (ctx, root, user) => {
      await setup.initialize.tokenManager(ctx, root)
      await setup.initialize.vault(ctx, root)
      await setup.initialize.reserve(ctx, root)
      await setup.initialize.hatch(ctx, root)
      await setup.initialize.controller(ctx, root)
    },
  },
  setPermissions: {
    controller: async (ctx, root, user) => {
      ctx.roles.controller = ctx.roles.controller || {}
      ctx.roles.controller.OPEN_HATCH_ROLE = await ctx.base.controller.OPEN_HATCH_ROLE()
      ctx.roles.controller.FINALIZE_HATCH_ROLE = await ctx.base.controller.FINALIZE_HATCH_ROLE()
      ctx.roles.controller.CONTRIBUTE_ROLE = await ctx.base.controller.CONTRIBUTE_ROLE()

      await ctx.acl.createPermission(user, ctx.controller.address, ctx.roles.controller.OPEN_HATCH_ROLE, root, { from: root })
      await ctx.acl.createPermission(ctx.hatch.address, ctx.controller.address, ctx.roles.controller.FINALIZE_HATCH_ROLE, root, { from: root })
      await ctx.acl.createPermission(user, ctx.controller.address, ctx.roles.controller.CONTRIBUTE_ROLE, root, { from: root })

      // for tests purposes only
      await ctx.acl.grantPermission(root, ctx.controller.address, ctx.roles.controller.ADD_COLLATERAL_TOKEN_ROLE, { from: root })
      await ctx.acl.grantPermission(user, ctx.controller.address, ctx.roles.controller.FINALIZE_HATCH_ROLE, { from: root })
    },
    tokenManager: async (ctx, root) => {
      ctx.roles.tokenManager = ctx.roles.tokenManager || {}
      ctx.roles.tokenManager.MINT_ROLE = await ctx.base.tokenManager.MINT_ROLE()
      ctx.roles.tokenManager.BURN_ROLE = await ctx.base.tokenManager.BURN_ROLE()
      ctx.roles.tokenManager.ISSUE_ROLE = await ctx.base.tokenManager.ISSUE_ROLE()
      ctx.roles.tokenManager.ASSIGN_ROLE = await ctx.base.tokenManager.ASSIGN_ROLE()
      ctx.roles.tokenManager.REVOKE_VESTINGS_ROLE = await ctx.base.tokenManager.REVOKE_VESTINGS_ROLE()

      await ctx.acl.createPermission(ctx.hatch.address, ctx.tokenManager.address, ctx.roles.tokenManager.BURN_ROLE, { from: root })
      await ctx.acl.createPermission(ctx.hatch.address, ctx.tokenManager.address, ctx.roles.tokenManager.ISSUE_ROLE, root, { from: root })
      await ctx.acl.createPermission(ctx.hatch.address, ctx.tokenManager.address, ctx.roles.tokenManager.ASSIGN_ROLE, root, { from: root })
      await ctx.acl.createPermission(ctx.hatch.address, ctx.tokenManager.address, ctx.roles.tokenManager.REVOKE_VESTINGS_ROLE, root, { from: root })
    },
    hatch: async (ctx, root) => {
      ctx.roles.hatch = ctx.roles.hatch || {}
      ctx.roles.hatch.OPEN_ROLE = await ctx.base.hatch.OPEN_ROLE()
      ctx.roles.hatch.CONTRIBUTE_ROLE = await ctx.base.hatch.CONTRIBUTE_ROLE()

      await ctx.acl.createPermission(ctx.controller.address, ctx.hatch.address, ctx.roles.hatch.OPEN_ROLE, root, { from: root })
      await ctx.acl.createPermission(ctx.controller.address, ctx.hatch.address, ctx.roles.hatch.CONTRIBUTE_ROLE, root, { from: root })
    },
    reserve: async (ctx, root) => {
      ctx.roles.reserve = ctx.roles.reserve || {}
      ctx.roles.reserve.ADD_PROTECTED_TOKEN_ROLE = await ctx.base.reserve.ADD_PROTECTED_TOKEN_ROLE()
      ctx.roles.reserve.TRANSFER_ROLE = await ctx.base.reserve.TRANSFER_ROLE()

      await ctx.acl.createPermission(ctx.controller.address, ctx.reserve.address, ctx.roles.reserve.ADD_PROTECTED_TOKEN_ROLE, root, { from: root })
    },
    vault: async (ctx, root) => {},
    all: async (ctx, root, user) => {
      await setup.setPermissions.controller(ctx, root, user)
      await setup.setPermissions.tokenManager(ctx, root)
      await setup.setPermissions.hatch(ctx, root)
      await setup.setPermissions.reserve(ctx, root)
      await setup.setPermissions.vault(ctx, root)
    },
  },
}

module.exports = setup
