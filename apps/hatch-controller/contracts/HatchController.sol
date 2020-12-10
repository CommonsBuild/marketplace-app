pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/common/EtherTokenConstant.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/apps-vault/contracts/Vault.sol";
import "@1hive/apps-marketplace-shared-interfaces/contracts/IHatch.sol";
import "@1hive/apps-marketplace-shared-interfaces/contracts/IMarketplaceController.sol";


contract HatchController is EtherTokenConstant, IsContract, IMarketplaceController, AragonApp {
    using SafeERC20 for ERC20;
    using SafeMath  for uint256;

    bytes32 public constant OPEN_HATCH_ROLE      = keccak256("OPEN_HATCH_ROLE");
    bytes32 public constant FINALIZE_HATCH_ROLE  = keccak256("FINALIZE_HATCH_ROLE");
    bytes32 public constant CONTRIBUTE_ROLE      = keccak256("CONTRIBUTE_ROLE");

    string private constant ERROR_CONTRACT_IS_EOA = "MARKETPLACE_CONTRACT_IS_EOA";

    IHatch public hatch;

    /***** external functions *****/

    /**
     * @notice Initialize Aragon Fundraising controller
     * @param _hatch     The address of the hatch contract
    */
    function initialize(
        IHatch _hatch
    )
        external
        onlyInit
    {
        require(isContract(_hatch),           ERROR_CONTRACT_IS_EOA);

        initialized();

        hatch = _hatch;
    }

    /* hatch related functions */

    /**
     * @notice Open hatch
    */
    function openHatch() external auth(OPEN_HATCH_ROLE) {
        hatch.open();
    }

    /**
     * @notice Close hatch and open trading
    */
    function closeHatch() external isInitialized {
        hatch.close();
    }

    /**
     * @notice Contribute to the hatch up to `@tokenAmount(self.contributionToken(): address, _value)`
     * @param _value The amount of contribution token to be spent
    */
    function contribute(uint256 _value) external payable authP(CONTRIBUTE_ROLE, arr(msg.sender, _value)) {
        hatch.contribute.value(msg.value)(msg.sender, _value);
    }

    /**
     * @notice Refund `_contributor`'s hatch contribution #`_vestedPurchaseId`
     * @param _contributor      The address of the contributor whose hatch contribution is to be refunded
     * @param _vestedPurchaseId The id of the contribution to be refunded
    */
    function refund(address _contributor, uint256 _vestedPurchaseId) external isInitialized {
        hatch.refund(_contributor, _vestedPurchaseId);
    }

    /**
     * @notice Open trading [enabling users to open buy and sell orders]
    */
    function finalizeHatch() external auth(FINALIZE_HATCH_ROLE) {
        return;
    }

    function contributionToken() public view isInitialized returns (address) {
        return hatch.contributionToken();
    }

    function balanceOf(address _who, address _token) public view isInitialized returns (uint256) {
        return _token == ETH ? _who.balance : ERC20(_token).staticBalanceOf(_who);
    }
}
