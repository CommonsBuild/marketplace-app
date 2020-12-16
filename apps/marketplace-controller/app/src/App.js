import React, { useEffect, useState } from 'react'
import { AragonApi, useAppState, useApi, useGuiStyle } from '@aragon/api-react'
import { Main, SyncIndicator } from '@aragon/ui'
import appStateReducer from './appStateReducer'
import { useInterval } from './hooks/use-interval'
import MainView from './views/MainView'
import HatchView from './views/HatchView'
import CollateralError from './screens/CollateralError'
import { Hatch, Polling } from './constants'
import HatchAbi from './abi/Hatch.json'

import './assets/global.css'

const App = () => {
  // *****************************
  // background script state
  // *****************************
  const { isReady, addresses, hatch } = useAppState()

  // *****************************
  // aragon api
  // *****************************
  const api = useApi()
  const { appearance } = useGuiStyle()
  // *****************************
  // internal state
  // *****************************
  const [isHatch, setIsHatch] = useState(null)
  const [hatchContract, setHatchContract] = useState(null)

  // check when the app is ready (it will mean hatch state and addresses too)
  // if so get the hatch state and contract
  useEffect(() => {
    if (isReady) {
      setIsHatch(hatch.state !== Hatch.state.CLOSED)
      setHatchContract(api.external(addresses.hatch, HatchAbi))
    }
  }, [isReady])

  // check if we are on hatch when the app is mounted
  useEffect(() => {
    const checkIsHatch = async () => {
      const newHatchState = Object.values(Hatch.state)[await hatchContract.state().toPromise()]
      setIsHatch(newHatchState !== Hatch.state.CLOSED)
    }
    // once hatch ended, no need to check anymore
    if (isReady && !isHatch) checkIsHatch()
  }, [])

  // polls if we are on hatch
  useInterval(async () => {
    // once hatch ended, no need to check anymore
    if (isReady && !isHatch) {
      const newHatchState = Object.values(Hatch.state)[await hatchContract.state().toPromise()]
      const newIsHatch = newHatchState !== Hatch.state.CLOSED
      if (newIsHatch !== isHatch) setIsHatch(newIsHatch)
    }
  }, Polling.DURATION)

  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      <SyncIndicator visible={!isReady || isHatch === null} />
      {isHatch && isReady && <HatchView />}
      {!isHatch && isReady && <MainView />}
    </Main>
  )
}

export default () => (
  <AragonApi reducer={appStateReducer}>
    <App />
  </AragonApi>
)
