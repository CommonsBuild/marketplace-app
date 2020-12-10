import Aragon, { events } from '@aragon/api'
import { zip } from 'rxjs'
import { first } from 'rxjs/operators'
import cloneDeep from 'lodash/cloneDeep'
import poolAbi from './abi/Pool.json'
import marketMakerAbi from './abi/BancorMarketMaker.json'
import hatchAbi from './abi/Hatch.json'
import miniMeTokenAbi from './abi/MiniMeToken.json'
import tokenDecimalsAbi from './abi/token-decimals.json'
import tokenNameAbi from './abi/token-name.json'
import tokenSymbolAbi from './abi/token-symbol.json'
import retryEvery from './utils/retryEvery'
import { Order, Hatch } from './constants'

const DEBUG = true
const MINI_ME_TOKEN_VERSION = "MMT_0.1"

// abis used to call decimals, name and symbol on a token
const tokenAbi = [].concat(tokenDecimalsAbi, tokenNameAbi, tokenSymbolAbi)

// Maps to maintain relationship between an address and a contract and its related data.
// It avoids redundants calls to the blockchain
const tokenContracts = new Map() // Addr -> External contract
const tokenDecimals = new Map() // External contract -> decimals
const tokenNames = new Map() // External contract -> name
const tokenSymbols = new Map() // External contract -> symbol

// bootstrap the Aragon API
const app = new Aragon()

// get the token address to initialize ourselves
const externals = zip(app.call('reserve'), app.call('marketMaker'), app.call('hatch'))
retryEvery(() => {
  externals
    .toPromise()
    .then(([poolAddress, marketMakerAddress, hatchAddress]) => {
      initialize(poolAddress, marketMakerAddress, hatchAddress)
    })
    .catch(err => {
      console.error('Could not start background script execution due to the contract not loading external contracts:', err)
      throw err
    })
})

const initialize = async (poolAddress, marketMakerAddress, hatchAddress) => {
  // get external smart contracts to listen to their events and interact with them
  const marketMakerContract = app.external(marketMakerAddress, marketMakerAbi)
  const poolContract = app.external(poolAddress, poolAbi)
  const hatchContract = app.external(hatchAddress, hatchAbi)

  // preload bonded token contract
  const bondedTokenAddress = await marketMakerContract.token().toPromise()
  const bondedTokenContract = app.external(bondedTokenAddress, miniMeTokenAbi)

  // preload bancor formula address
  const formulaAddress = await marketMakerContract.formula().toPromise()

  // get network characteristics
  const network = await app
    .network()
    .pipe(first())
    .toPromise()

  // some settings used by subsequent calls
  const settings = {
    network,
    marketMaker: {
      address: marketMakerAddress,
      contract: marketMakerContract,
    },
    pool: {
      address: poolAddress,
      contract: poolContract,
    },
    hatch: {
      address: hatchAddress,
      contract: hatchContract,
    },
    bondedToken: {
      address: bondedTokenAddress,
      contract: bondedTokenContract,
    },
    formula: {
      address: formulaAddress,
    },
  }

  // init the aragon API store
  // first param is a function handling blockchain events and updating the store'state accordingly
  // second param is an object with a way to refresh the initial loaded state (cached one, in the client's IndexedDB)
  // and the external contracts on which we want to listen events
  return app.store(
    async (state, evt) => {
      // prepare the next state from the current one
      const nextState = {
        ...state,
      }
      if (DEBUG) {
        console.log('#########################')
        console.log(evt.event)
        console.log(evt)
        console.log('#########################')
      }
      const { event, returnValues, blockNumber, transactionHash, logIndex } = evt
      switch (event) {
        // app is syncing
        case events.SYNC_STATUS_SYNCING:
          return { ...nextState, isSyncing: true }
        // done syncing
        case events.SYNC_STATUS_SYNCED:
          return { ...nextState, isSyncing: false }
        /***********************
         * Fundraising events
         ***********************/
        case 'AddCollateralToken':
        case 'UpdateCollateralToken':
          return handleCollateralToken(nextState, returnValues, settings)
        case 'RemoveCollateralToken':
          return removeCollateralToken(nextState, returnValues)
        case 'MakeBuyOrder':
        case 'MakeSellOrder':
          return newOrder(nextState, returnValues, settings, blockNumber, transactionHash, logIndex)
        case 'UpdateFees':
          return updateFees(nextState, returnValues)
        case 'SetOpenDate':
          return setOpenDate(nextState, returnValues, settings)
        case 'Contribute':
          return addContribution(nextState, returnValues, settings, blockNumber)
        case 'Close':
          return closeHatch(nextState, settings)
        case 'Refund':
          return removeContribution(nextState, returnValues)
        default:
          return nextState
      }
    },
    {
      init: initState(settings),
      externals: [marketMakerContract, poolContract, hatchContract].map(c => ({ contract: c })),
    }
  )
}

/**
 * Merges the initial state with the cached one (in the client's IndexedDB))
 * @param {Object} settings - the settings needed to access external contracts data
 * @returns {Object} a merged state between the cached one and data coming from external contracts
 */
const initState = settings => async cachedState => {
  const newState = {
    isSyncing: true,
    addresses: {
      marketMaker: settings.marketMaker.address,
      pool: settings.pool.address,
      hatch: settings.hatch.address,
      formula: settings.formula.address,
    },
    network: settings.network,
    ...cachedState,
  }
  const withContractsData = await loadContractsData(newState, settings)
  const withDefaultValues = loadDefaultValues(withContractsData)

  return withDefaultValues
}

/**
 * Loads relevant data related to the fundraising smart contracts
 * @param {Object} state - the current store's state
 * @param {Object} settings - the settings needed to access external contracts data
 * @returns {Object} the current store's state augmented with the smart contracts data
 */
const loadContractsData = async (state, { bondedToken, marketMaker, hatch, network }) => {
  // loads data related to the bonded token, market maker and hatch contracts
  const [
    symbol,
    name,
    decimals,
    totalSupply,
    PPM,
    buyFeePct,
    sellFeePct,
    PCT_BASE,
    hatchState,
    openDate,
    period,
    vestingCliffPeriod,
    vestingCompletePeriod,
    goal,
    totalRaised,
    exchangeRate,
    contributionToken,
    token,
  ] = await Promise.all([
    // bonded token data
    bondedToken.contract.symbol().toPromise(),
    bondedToken.contract.name().toPromise(),
    bondedToken.contract.decimals().toPromise(),
    bondedToken.contract.totalSupply().toPromise(),
    // market maker data
    marketMaker.contract.PPM().toPromise(),
    marketMaker.contract.buyFeePct().toPromise(),
    marketMaker.contract.sellFeePct().toPromise(),
    marketMaker.contract.PCT_BASE().toPromise(),
    // hatch data
    hatch.contract.state().toPromise(),
    hatch.contract.openDate().toPromise(),
    hatch.contract.period().toPromise(),
    hatch.contract.vestingCliffPeriod().toPromise(),
    hatch.contract.vestingCompletePeriod().toPromise(),
    hatch.contract.goal().toPromise(),
    hatch.contract.totalRaised().toPromise(),
    hatch.contract.exchangeRate().toPromise(),
    hatch.contract.contributionToken().toPromise(),
    hatch.contract.token().toPromise(),
  ])

  // find the corresponding contract in the in memory map or get the external
  const contributionTokenContract = tokenContracts.has(contributionToken) ? tokenContracts.get(contributionToken) : app.external(contributionToken, tokenAbi)
  tokenContracts.set(contributionToken, contributionTokenContract)
  const tokenContract = tokenContracts.has(token) ? tokenContracts.get(token) : app.external(token, tokenAbi)
  tokenContracts.set(token, tokenContract)
  // load hatch contributionToken data
  const [contributionTokenSymbol, contributionTokenName, contributionTokenDecimals, tokenSymbol, tokenName, tokenDecimals] = await Promise.all([
    loadTokenSymbol(contributionTokenContract, contributionToken, { network }),
    loadTokenName(contributionTokenContract, contributionToken, { network }),
    loadTokenDecimals(contributionTokenContract, contributionToken, { network }),
    loadTokenSymbol(tokenContract, token, { network }),
    loadTokenName(tokenContract, token, { network }),
    loadTokenDecimals(tokenContract, token, { network }),
  ])
  return {
    ...state,
    constants: {
      ...state.constants,
      PPM,
      PCT_BASE,
    },
    values: {
      ...state.values,
      buyFeePct,
      sellFeePct,
    },
    hatch: {
      state: Object.values(Hatch.state)[hatchState],
      contributionToken: {
        address: contributionToken,
        symbol: contributionTokenSymbol,
        name: contributionTokenName,
        decimals: parseInt(contributionTokenDecimals, 10),
      },
      token: {
        address: token,
        symbol: tokenSymbol,
        name: tokenName,
        decimals: parseInt(tokenDecimals, 10),
      },
      openDate: parseInt(openDate, 10) * 1000, // in ms
      period: parseInt(period, 10) * 1000, // in ms
      vestingCliffPeriod: parseInt(vestingCliffPeriod, 10) * 1000, // in ms
      vestingCompletePeriod: parseInt(vestingCompletePeriod, 10) * 1000, // in ms
      exchangeRate,
      goal,
      totalRaised,
    },
    bondedToken: {
      address: bondedToken.address,
      symbol,
      name,
      decimals: parseInt(decimals, 10),
      totalSupply,
      // realSupply and overallSupply will be calculated on the reducer
    },
  }
}

/**
 * Intialize background script state with default values
 * @param {Object} state - the current store's state
 * @returns {Object} the current store's state augmented with default values where needed
 */
const loadDefaultValues = state => {
  // set empty maps and arrays if not populated yet
  // (that's why new values are on top of the returned object, will be overwritten if exists in the state)
  // for collaterals and orders
  return {
    collaterals: new Map(),
    orders: [],
    contributions: new Map(),
    ...state,
  }
}

/***********************
 *                     *
 *   Event Handlers    *
 *                     *
 ***********************/

const handleCollateralToken = async (state, { collateral, reserveRatio, virtualBalance, virtualSupply }, settings) => {
  const collaterals = cloneDeep(state.collaterals)
  // find the corresponding contract in the in memory map or get the external
  const tokenContract = tokenContracts.has(collateral) ? tokenContracts.get(collateral) : app.external(collateral, tokenAbi)
  tokenContracts.set(collateral, tokenContract)
  // loads data related to the collateral token
  const [symbol, name, decimals, actualBalance, isMiniMeToken] = await Promise.all([
    loadTokenSymbol(tokenContract, collateral, settings),
    loadTokenName(tokenContract, collateral, settings),
    loadTokenDecimals(tokenContract, collateral, settings),
    loadTokenBalance(collateral, settings),
    isAddressMiniMeToken(collateral),
  ])
  collaterals.set(collateral, {
    ...collaterals.get(collateral),
    symbol,
    name,
    decimals: parseInt(decimals, 10),
    reserveRatio,
    virtualSupply,
    virtualBalance,
    actualBalance, // will be polled on the frontend too, until aragon.js PR#361 gets merged
    isMiniMeToken,
  })
  return {
    ...state,
    collaterals,
  }
}

const removeCollateralToken = (state, { collateral }) => {
  // find the corresponding contract in the in memory map or get the external
  const tokenContract = tokenContracts.has(collateral) ? tokenContracts.get(collateral) : app.external(collateral, tokenAbi)
  // remove all data related to this token
  tokenContracts.delete(collateral)
  tokenDecimals.delete(tokenContract)
  tokenNames.delete(tokenContract)
  tokenSymbols.delete(tokenContract)
  const collaterals = cloneDeep(state.collaterals).delete(collateral)
  return {
    ...state,
    collaterals,
  }
}

const newOrder = async (
  state,
  { buyer, seller, collateral, purchaseAmount, sellAmount, returnedAmount, fee, feePct },
  settings,
  blockNumber,
  transactionHash,
  logIndex
) => {
  const orders = cloneDeep(state.orders)
  // if it's a buy order, seller and sellAmount will undefined
  // if it's a sell order, buyer and purchaseAmount will be undefined
  const type = buyer ? Order.type.BUY : Order.type.SELL
  const tokenContract = tokenContracts.has(collateral) ? tokenContracts.get(collateral) : app.external(collateral, tokenAbi)
  const [timestamp, symbol, bondedToken] = await Promise.all([
    loadTimestamp(blockNumber),
    loadTokenSymbol(tokenContract, collateral, settings),
    updateBondedToken(state.bondedToken, settings),
  ])
  const newOrder = {
    transactionHash,
    logIndex,
    timestamp,
    collateral,
    symbol,
    user: buyer || seller,
    type,
    state: Order.state.CLAIMED,
    amount: sellAmount || returnedAmount,
    value: purchaseAmount || returnedAmount,
    fee, // can be undefined
    feePct, // can be undefined
    // price is calculated in the reducer
  }
  // because of chain re-orgs, events can be fired more than once
  // transactionHash + logIndex make a good uniqueness identifier
  const orderIndex = orders.findIndex(o => {
    return o.transactionHash === transactionHash && o.logIndex === logIndex
  })
  const orderFound = orderIndex !== -1
  // update the order in place if already in the list
  if (orderFound) orders[orderIndex] = newOrder
  // add the order if not in the list
  else orders.push(newOrder)
  return {
    ...state,
    orders,
    bondedToken,
  }
}

const updateFees = (state, { buyFeePct, sellFeePct }) => {
  return {
    ...state,
    values: {
      ...state.values,
      buyFeePct,
      sellFeePct,
    },
  }
}

const setOpenDate = async (state, { date }, { hatch }) => {
  const openDate = parseInt(date, 10) * 1000 // in ms
  // update the state of the hatch
  const hatchState = await hatch.contract.state().toPromise()
  return {
    ...state,
    hatch: {
      ...state.hatch,
      state: Object.values(Hatch.state)[hatchState],
      openDate,
    },
  }
}
const addContribution = async (state, { contributor, value, amount, vestedPurchaseId }, { hatch }, blockNumber) => {
  // get the user contributions
  const contributions = cloneDeep(state.contributions)
  const userContributions = contributions.get(contributor) || []
  // we call `hatch.contract.totalRaised` instead of directly to the claculation here
  // because we can't make BigNumber calculations from the background script
  // and pass it to the fronted
  const [totalRaised, timestamp] = await Promise.all([hatch.contract.totalRaised().toPromise(), loadTimestamp(blockNumber)])
  const newContribution = {
    value,
    amount,
    vestedPurchaseId,
    timestamp,
  }
  const contributionIndex = userContributions.findIndex(c => c.contributor === contributor && c.vestedPurchaseId === vestedPurchaseId)
  const contributionFound = contributionIndex !== -1
  // update the contribution in place if already in the list
  if (contributionFound) userContributions[contributionIndex] = newContribution
  // add the contribution if not in the list
  else userContributions.push(newContribution)
  contributions.set(contributor, userContributions)
  return {
    ...state,
    hatch: {
      ...state.hatch,
      totalRaised,
    },
    contributions,
  }
}

const closeHatch = async (state, settings) => {
  const bondedToken = await updateBondedToken(state.bondedToken, settings)
  return {
    ...state,
    hatch: {
      ...state.hatch,
      state: Hatch.state.CLOSED,
    },
    bondedToken,
  }
}

const removeContribution = (state, { contributor, value, amount, vestedPurchaseId }) => {
  const contributions = cloneDeep(state.contributions)
  const userContributions = contributions.get(contributor)
  if (userContributions) {
    const newUserContributions = userContributions.filter(c => c.vestedPurchaseId !== vestedPurchaseId)
    contributions.set(contributor, newUserContributions)
    return {
      ...state,
      contributions,
    }
  } else return state
}

/***********************
 *                     *
 *       Helpers       *
 *                     *
 ***********************/

/**
 * Get the current balance of a given collateral
 * @param {String} tokenAddress - the given token address
 * @param {Object} settings - the settings where the pool address is
 * @returns {Promise} a promise that resolves the balance
 */
const loadTokenBalance = (tokenAddress, { pool }) => {
  return app.call('balanceOf', pool.address, tokenAddress).toPromise()
}

/**
 * Get the decimals of a given token contract
 * @param {String} tokenContract - token contract
 * @param {String} tokenAddress - token address
 * @param {Object} settings - settings object where the network details are
 * @returns {String} the decimals or a fallback (decimals are optional)
 */
const loadTokenDecimals = async (tokenContract, tokenAddress, { network }) => {
  if (tokenDecimals.has(tokenContract)) {
    return tokenDecimals.get(tokenContract)
  }
  const fallback = '0'
  let decimals
  try {
    decimals = (await tokenContract.decimals().toPromise()) || fallback
    tokenDecimals.set(tokenContract, decimals)
  } catch (err) {
    // decimals is optional
    decimals = fallback
  }
  return decimals
}

/**
 * Get the name of a given token contract
 * @param {String} tokenContract - token contract
 * @param {String} tokenAddress - token address
 * @param {Object} settings - settings object where the network details are
 * @returns {String} the name or a fallback (name is optional)
 */
const loadTokenName = async (tokenContract, tokenAddress, { network }) => {
  if (tokenNames.has(tokenContract)) {
    return tokenNames.get(tokenContract)
  }
  const fallback = ''
  let name
  try {
    name = (await tokenContract.name().toPromise()) || fallback
    tokenNames.set(tokenContract, name)
  } catch (err) {
    // name is optional
    name = fallback
  }
  return name
}

/**
 * Get the symbol of a given token contract
 * @param {String} tokenContract - token contract
 * @param {String} tokenAddress - token address
 * @param {Object} settings - settings object where the network details are
 * @returns {String} the symbol or a fallback (symbol is optional)
 */
const loadTokenSymbol = async (tokenContract, tokenAddress, { network }) => {
  if (tokenSymbols.has(tokenContract)) {
    return tokenSymbols.get(tokenContract)
  }
  const fallback = ''
  let symbol
  try {
    symbol = (await tokenContract.symbol().toPromise()) || fallback
    tokenSymbols.set(tokenContract, symbol)
  } catch (err) {
    // symbol is optional
    symbol = fallback
  }
  return symbol
}

const isAddressMiniMeToken = async (collateralAddress) => {
  try {
    return await app
      .external(collateralAddress, miniMeTokenAbi)
      .version()
      .toPromise() === MINI_ME_TOKEN_VERSION
  } catch (error) {
    console.log(`Collateral ${collateralAddress} not minime token:`, error)
    return false
  }
}

/**
 * Gets the timestamp of the given block
 * @param {String} blockNumber - the block number of which we want the timestamp
 * @returns {Number} the timestamp of the given block in ms
 */
const loadTimestamp = async blockNumber => {
  return retryEvery(() =>
    app
      .web3Eth('getBlock', blockNumber)
      .toPromise()
      .then(block => parseInt(block.timestamp, 10) * 1000) // in ms
      .catch(err => {
        throw err
      })
  )
}

/**
 * Updates the bonded token when an order or claim happens
 * @param {Object} bondedToken - the bonded token to update
 * @param {Object} settings - settings object where the needed contracts are
 * @returns {Object} the updated bonded token
 */
const updateBondedToken = async (bondedToken, settings) => {
  const updatedBondedToken = cloneDeep(bondedToken)
  const totalSupply = await settings.bondedToken.contract.totalSupply().toPromise()

  return {
    ...updatedBondedToken,
    totalSupply,
  }
}
