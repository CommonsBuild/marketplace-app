export const Hatch = {
  state: {
    // hatch is idle and pending to be started
    PENDING: 'PENDING',
    // hatch has started and contributors can purchase tokens
    FUNDING: 'FUNDING',
    // hatch has not reach goal within period and contributors can claim refunds
    REFUNDING: 'REFUNDING',
    // hatch has reached goal within period and trading is ready to be open
    GOAL_REACHED: 'GOAL_REACHED',
    // hatch has reached goal within period, has been closed and trading has been open
    CLOSED: 'CLOSED',
  },
}
