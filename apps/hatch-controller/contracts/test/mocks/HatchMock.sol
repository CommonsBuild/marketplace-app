pragma solidity 0.4.24;

import "@aragon/contract-helpers-test/contracts/0.4/aragonOS/TimeHelpersMock.sol";
import "@1hive/apps-marketplace-hatch/contracts/Hatch.sol";


contract HatchMock is Hatch, TimeHelpersMock {}
