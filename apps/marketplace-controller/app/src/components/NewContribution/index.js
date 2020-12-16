import React, { useContext } from 'react'
import { SidePanel } from '@aragon/ui'
import { HatchViewContext } from '../../context'
import Contribution from './Contribution'

export default () => {
  // *****************************
  // context state
  // *****************************
  const { hatchPanel, setHatchPanel } = useContext(HatchViewContext)

  return (
    <SidePanel title="New Contribution" opened={hatchPanel} onClose={() => setHatchPanel(false)}>
      <Contribution />
    </SidePanel>
  )
}
