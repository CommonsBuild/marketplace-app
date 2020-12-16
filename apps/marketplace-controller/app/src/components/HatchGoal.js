import React, { useContext } from 'react'
import { useAppState, useApi, useConnectedAccount } from '@aragon/api-react'
import { Box, Button, useTheme, GU, color } from '@aragon/ui'
import CircleGraph from '../components/CircleGraph'
import { HatchViewContext } from '../context'
import { Hatch } from '../constants'
import { formatBigNumber } from '../utils/bn-utils'

export default () => {
  // *****************************
  // background script state
  // *****************************
  const {
    hatch: {
      contributionToken: { symbol, decimals },
      goal,
      totalRaised,
    },
  } = useAppState()

  // *****************************
  // aragon api
  // *****************************
  const theme = useTheme()
  const api = useApi()
  const account = useConnectedAccount()

  // *****************************
  // context state
  // *****************************
  const { state, setRefundPanel } = useContext(HatchViewContext)

  // *****************************
  // misc
  // *****************************
  const circleColor = {
    [Hatch.state.PENDING]: color('#ecedf1'),
    [Hatch.state.FUNDING]: theme.accent,
    [Hatch.state.GOAL_REACHED]: theme.positive,
    [Hatch.state.REFUNDING]: theme.negative,
    [Hatch.state.CLOSED]: color('#21c1e7'),
  }

  /**
   * Calls the `hatch.close` smart contarct function on button click
   * @param {Object} event - the event to prevent
   * @returns {void}
   */
  const handleOpenTrading = event => {
    event.preventDefault()
    if (account) {
      api
        .closeHatch()
        .toPromise()
        .catch(console.error)
    }
  }

  return (
    <Box heading="Hatch Goal">
      <div className="circle">
        <CircleGraph value={totalRaised.div(goal).toNumber()} size={20.5 * GU} width={6} color={circleColor[state]} />
        <p
          title={`${formatBigNumber(totalRaised, decimals)} ${symbol} of ${formatBigNumber(goal, decimals)} ${symbol}`}
          css={`
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: ${theme.surfaceContentSecondary};
          `}
        >
          <span
            css={`
              color: ${theme.surfaceContent};
            `}
          >
            {formatBigNumber(totalRaised, decimals)}
          </span>{' '}
          {symbol} of{' '}
          <span
            css={`
              color: ${theme.surfaceContent};
            `}
          >
            {formatBigNumber(goal, decimals)}
          </span>{' '}
          {symbol}
        </p>
        {state === Hatch.state.GOAL_REACHED && (
          <>
            <p
              css={`
                white-space: nowrap;
                margin-top: ${2 * GU}px;
                color: ${theme.surfaceContent};
              `}
            >
              <strong>Hatch goal completed! 🎉</strong>
            </p>
            <Button
              wide
              mode="strong"
              label="Open trading"
              css={`
                margin-top: ${2 * GU}px;
                width: 100%;
              `}
              onClick={handleOpenTrading}
            >
              Open trading
            </Button>
          </>
        )}
        {state === Hatch.state.REFUNDING && (
          <>
            <p
              css={`
                margin-top: ${2 * GU}px;
              `}
            >
              Unfortunately, the goal set for this hatch has not been reached.
            </p>
            <Button
              wide
              mode="strong"
              label="Refund Hatch Tokens"
              css={`
                margin-top: ${2 * GU}px;
                width: 100%;
              `}
              onClick={() => setRefundPanel(true)}
            >
              Refund hatch shares
            </Button>
          </>
        )}
      </div>
    </Box>
  )
}
