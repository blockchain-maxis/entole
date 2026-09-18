// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal ERC20 surface this vault needs.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title GrowthVault
/// @notice Holds the balance behind the app's "Grow" feature. Deliberately a
/// separate contract from `EntolePolicy`, which never custodies funds by
/// design (see its own doc comment) — a deposit vault has to hold a balance,
/// so it does not belong on that trust boundary. This contract has no
/// delegate/allowance concept at all: only the owner who deposited can
/// withdraw their own balance, there is no assistant-initiated path here.
///
/// Accrual/earnings math is intentionally not on-chain here — the balance
/// this contract tracks is exactly what was deposited minus what was
/// withdrawn, nothing more. Display-layer "what's growing" projections are
/// computed off-chain; this contract is the one thing that has to be honest
/// about the real, settled deposit.
contract GrowthVault {
    IERC20 public immutable token;

    mapping(address => uint256) public balanceOf;

    event Deposited(address indexed owner, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed owner, uint256 amount, uint256 newBalance);

    error ZeroAmount();
    error InsufficientBalance();
    error TransferFailed();

    constructor(address tokenAddress) {
        token = IERC20(tokenAddress);
    }

    /// @notice Pulls `amount` from the caller's own balance (via a standing
    /// `approve`, same pattern `EntolePolicy` uses) and credits it here.
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount, balanceOf[msg.sender]);

        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();
    }

    /// @notice Returns `amount` of the caller's own deposited balance. No
    /// caveat, no delegate, no allowance — only the depositor can ever call
    /// this for their own funds.
    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();

        balanceOf[msg.sender] -= amount;
        emit Withdrawn(msg.sender, amount, balanceOf[msg.sender]);

        bool ok = token.transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();
    }
}
