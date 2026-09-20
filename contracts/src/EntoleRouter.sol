// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev The one function of ERC-3009 this router needs. Agora AUSD implements it.
interface IReceiveWithAuthorization {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Gasless, single-signature payments with a protocol fee, atomically.
///
/// The payer signs ONE ERC-3009 `ReceiveWithAuthorization` moving
/// `amount + fee` to this router. Anyone (in practice, Entole's relayer, which
/// pays the gas) submits it via `pay`; the router pulls the funds, then pays the
/// recipient and the treasury in the same transaction. If any step fails, every
/// step reverts.
///
/// Why a relayer cannot redirect the money: the token's signature covers only
/// `(from, to = this router, value, validity, nonce)`. So the signer sets the
/// authorization `nonce` to a hash of the payment's terms —
/// `paymentNonce(recipient, amount, fee, salt)` — and `pay` recomputes it from
/// its own arguments. Change the recipient, the amount or the fee and the nonce
/// no longer matches what was signed, so the token rejects the signature.
///
/// The fee is computed here from immutable parameters, never taken from the
/// caller: `bps` of the amount, clamped to `[minFee, maxFee]`. Amounts are in
/// the token's smallest unit (AUSD: 6 decimals).
contract EntoleRouter {
    address public immutable token;
    address public immutable treasury;
    uint256 public immutable feeBps;
    uint256 public immutable minFee;
    uint256 public immutable maxFee;

    event Paid(address indexed from, address indexed recipient, uint256 amount, uint256 fee, bytes32 salt);

    error ZeroAddress();
    error ZeroAmount();
    error BadFeeConfig();
    error TransferFailed();

    constructor(address token_, address treasury_, uint256 feeBps_, uint256 minFee_, uint256 maxFee_) {
        if (token_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        // A hard ceiling of 5% means even a mistaken deploy can't be predatory.
        if (feeBps_ > 500 || minFee_ > maxFee_) revert BadFeeConfig();
        token = token_;
        treasury = treasury_;
        feeBps = feeBps_;
        minFee = minFee_;
        maxFee = maxFee_;
    }

    /// @notice The fee charged on `amount`: `feeBps` of it, clamped to [minFee, maxFee].
    function feeFor(uint256 amount) public view returns (uint256 fee) {
        fee = (amount * feeBps) / 10_000;
        if (fee < minFee) fee = minFee;
        if (fee > maxFee) fee = maxFee;
    }

    /// @notice The authorization nonce the payer must sign so the terms of the
    /// payment are part of the signature. Pure, so the app computes the same value.
    function paymentNonce(address recipient, uint256 amount, uint256 fee, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(recipient, amount, fee, salt));
    }

    /// @notice Submit a payer's signed authorization. Callable by anyone — the
    /// signature, not the caller, is what authorises the movement.
    /// @param from The payer who signed.
    /// @param recipient Who receives `amount`.
    /// @param amount What the recipient gets. The payer signed `amount + feeFor(amount)`.
    /// @param salt Per-payment randomness chosen by the payer, so two identical
    /// payments have distinct nonces.
    function pay(
        address from,
        address recipient,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 fee = feeFor(amount);
        bytes32 nonce = paymentNonce(recipient, amount, fee, salt);

        IReceiveWithAuthorization(token).receiveWithAuthorization(
            from, address(this), amount + fee, validAfter, validBefore, nonce, v, r, s
        );

        _send(recipient, amount);
        _send(treasury, fee);

        emit Paid(from, recipient, amount, fee, salt);
    }

    function _send(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Transfer.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
