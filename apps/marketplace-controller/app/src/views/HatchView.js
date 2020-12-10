import React, { useState, useEffect } from 'react'
import { unstable_batchedUpdates as batchedUpdates } from 'react-dom'
import { useAppState, useApi, useConnectedAccount, useNetwork } from '@aragon/api-react'
import { Header, Button } from '@aragon/ui'
import BigNumber from 'bignumber.js'
import { useInterval } from '../hooks/use-interval'
import { Hatch as HatchConstants, Polling } from '../constants'
import Hatch from '../screens/Hatch'
import NewContribution from '../components/NewContribution'
import NewRefund from '../components/NewRefund'
import { IdentityProvider } from '../components/IdentityManager'
import { HatchViewContext } from '../context'
import HatchAbi from '../abi/Hatch.json'

export default () => {
  // *****************************
  // background script state
  // *****************************
  const {
    addresses: { hatch: hatchAddress },
    hatch: {
      state,
      openDate,
      contributionToken: { address },
    },
  } = useAppState()

  // *****************************
  // aragon api
  // *****************************
  const api = useApi()
  const hatch = api.external(hatchAddress, HatchAbi)
  const connectedUser = useConnectedAccount()
  const { type: networkType } = useNetwork()

  // *****************************
  // internal state, also shared through context
  // *****************************
  const [hatchPanel, setHatchPanel] = useState(false)
  const [refundPanel, setRefundPanel] = useState(false)

  // *****************************
  // context state
  // *****************************
  const [polledOpenDate, setPolledOpenDate] = useState(openDate)
  const [polledHatchState, setPolledHatchState] = useState(state)
  const [userPrimaryCollateralBalance, setUserPrimaryCollateralBalance] = useState(new BigNumber(0))
  const context = {
    openDate: polledOpenDate,
    state: polledHatchState,
    userPrimaryCollateralBalance: userPrimaryCollateralBalance,
    hatchPanel,
    setHatchPanel,
    refundPanel,
    setRefundPanel,
  }

  // *****************************
  // identity handlers
  // *****************************
  const handleResolveLocalIdentity = address => {
    return api.resolveAddressIdentity(address).toPromise()
  }
  const handleShowLocalIdentityModal = address => {
    return api.requestAddressIdentityModification(address).toPromise()
  }

  // watch for a connected user and get its balances
  useEffect(() => {
    const getUserPrimaryCollateralBalance = async () => {
      setUserPrimaryCollateralBalance(new BigNumber(await api.call('balanceOf', connectedUser, address).toPromise()))
    }
    if (connectedUser) {
      getUserPrimaryCollateralBalance()
    }
  }, [connectedUser])

  // polls the start date
  useInterval(async () => {
    let newOpenDate = polledOpenDate
    let newUserPrimaryCollateralBalance = userPrimaryCollateralBalance
    let newHatchState = polledHatchState
    // only poll if the openDate is not set yet
    if (openDate === 0) newOpenDate = parseInt(await hatch.openDate().toPromise(), 10)
    // only poll if there is a connected user
    if (connectedUser) newUserPrimaryCollateralBalance = new BigNumber(await api.call('balanceOf', connectedUser, address).toPromise())
    // poll hatch state
    newHatchState = Object.values(HatchConstants.state)[await hatch.state().toPromise()]
    // TODO: keep an eye on React 17
    batchedUpdates(() => {
      // only update if values are different
      if (newOpenDate !== polledOpenDate) setPolledOpenDate(newOpenDate)
      if (!newUserPrimaryCollateralBalance.eq(userPrimaryCollateralBalance)) setUserPrimaryCollateralBalance(newUserPrimaryCollateralBalance)
      if (newHatchState !== polledHatchState) setPolledHatchState(newHatchState)
    })
  }, Polling.DURATION)

  return (
    <HatchViewContext.Provider value={context}>
      <IdentityProvider onResolve={handleResolveLocalIdentity} onShowLocalIdentityModal={handleShowLocalIdentityModal}>
        <Header
          primary="Marketplace Hatch"
          secondary={
            <Button
              disabled={polledHatchState !== HatchConstants.state.FUNDING}
              mode="strong"
              label="Buy hatch shares"
              onClick={() => setHatchPanel(true)}
            />
          }
        />
        <Hatch />
        <NewContribution />
        <NewRefund />
      </IdentityProvider>
    </HatchViewContext.Provider>
  )
}
