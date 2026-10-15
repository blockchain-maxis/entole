// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal ERC20 surface. The owner keeps custody of their own funds;
/// this contract only ever draws against a standing `approve`.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title EntolePolicy
/// @notice The only layer in Entole allowed to think is arithmetic. The
/// assistant proposes; the app assembles; this contract is the one thing
/// that decides, and it never calls a model, never trusts a claim from the
/// app or the backend, and never custodies funds itself.
///
/// An allowance is a scoped delegation: one owner, one delegate (a session
/// key held by the app/backend on the assistant's behalf), a recipient
/// allow-list, a per-transaction maximum, a rolling spend cap per period, an
/// expiry, and a revocation switch that is effective on the next block.
///
/// If a caveat can be bypassed by the app or the backend behaving badly, it
/// does not belong in this contract's threat model — the delegate key has no
/// authority beyond what `execute` checks, full stop.
///
/// Version 2 adds the undo window as a caveat. An allowance written with an
/// `undoSeconds` cannot be spent at once: the delegate proposes a run, the run
/// waits that long, and only then can anyone carry it out. The owner, or the
/// delegate itself, can cancel it until then, and a pause or a revocation in
/// the meantime stops it too. A stolen delegate key cannot skip the wait.
contract EntolePolicy {
    struct Allowance {
        address owner;
        address delegate;
        address token;
        uint256 perRunMax;
        uint256 periodCap;
        uint256 periodSeconds;
        uint256 periodStart;
        uint256 spentInPeriod;
        uint256 expiresAt;
        bool revoked;
        /// @notice How long a proposed run waits before it can be carried out.
        /// Zero means the delegate may spend at once with `execute`.
        uint256 undoSeconds;
    }

    /// @notice A run proposed inside an allowance, waiting out its undo window.
    struct Run {
        bytes32 id;
        address recipient;
        uint256 amount;
        uint64 readyAt;
        uint64 expiresAt;
        /// @dev The allowance's generation when proposed. A replace or a
        /// revocation moves it on, and a run from before is void.
        uint64 generation;
    }

    struct PassKey {
        uint256 x;
        uint256 y;
        bool set;
    }

    /// @dev RIP-7212 secp256r1 verifier. Input is hash‖r‖s‖x‖y, 32 bytes
    /// each, big-endian. Output is 32 bytes of 0x…01 on a valid signature,
    /// empty on anything else — never reverts on a bad signature.
    address public constant P256_VERIFIER = 0x0000000000000000000000000000000000000100;

    mapping(bytes32 => Allowance) public allowances;
    mapping(bytes32 => mapping(address => bool)) public recipientAllowed;
    /// @dev Kept only so a replace by the same owner can clear the old
    /// allow-list; `recipientAllowed` stays the source of truth for checks.
    mapping(bytes32 => address[]) private _recipientList;
    /// @notice Pause is per owner and blocks every allowance they hold in one
    /// call — the kill switch reachable from any screen.
    mapping(address => bool) public paused;
    /// @notice The passkey allowed to sign a revocation for an owner,
    /// registered once from the owner's own transaction during onboarding.
    mapping(address => PassKey) public passkeys;
    /// @notice Per-delegate counter consumed by `executeFor`, so a signed run
    /// can be submitted exactly once.
    mapping(address => uint256) public nonces;
    /// @notice Runs proposed and not yet carried out or cancelled.
    mapping(bytes32 => Run) public runs;
    /// @notice What waiting runs hold back against an allowance's period cap,
    /// so several proposed together can never add up past it.
    mapping(bytes32 => uint256) public reserved;
    /// @notice Moves on whenever an allowance is replaced or revoked, voiding its waiting runs.
    mapping(bytes32 => uint64) public generation;
    /// @dev Makes every run id unique.
    uint256 private _runCount;

    /// @notice The longest an allowance may ask a run to wait.
    uint256 public constant MAX_UNDO_SECONDS = 1 days;
    /// @notice How long after its undo window a run may still be carried out.
    /// One left longer is stale: it is not sent, and can only be cancelled.
    uint256 public constant RUN_WINDOW = 15 minutes;

    bytes32 public constant EXECUTE_TYPEHASH =
        keccak256("Execute(bytes32 id,address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant PROPOSE_TYPEHASH =
        keccak256("Propose(bytes32 id,address recipient,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 runId,uint256 deadline)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    /// @dev Upper bound for a canonical (low-s) secp256k1 signature.
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event AllowanceCreated(bytes32 indexed id, address indexed owner, address indexed delegate);
    event AllowanceRevoked(bytes32 indexed id, address indexed owner);
    event Paused(address indexed owner, bool paused);
    event Executed(bytes32 indexed id, address indexed recipient, uint256 amount);
    event PasskeyRegistered(address indexed owner, uint256 x, uint256 y);
    event Proposed(
        bytes32 indexed runId, bytes32 indexed id, address indexed recipient, uint256 amount, uint256 readyAt
    );
    event Cancelled(bytes32 indexed runId, bytes32 indexed id);
    event RunCarriedOut(bytes32 indexed runId, bytes32 indexed id);

    error NotOwner();
    error NotDelegate();
    error AlreadyRevoked();
    error Expired();
    error AccountPaused();
    error RecipientNotAllowed();
    error OverPerRunMax();
    error OverPeriodCap();
    error BadSignature();
    error InvalidPeriod();
    error TransferFailed();
    error IdTaken();
    error SignatureExpired();
    error UndoWindowRequired();
    error UndoTooLong();
    error NoSuchRun();
    error TooEarly();
    error RunExpired();
    error NotAllowedToCancel();
    error RunVoid();

    modifier onlyOwner(bytes32 id) {
        if (allowances[id].owner != msg.sender) revert NotOwner();
        _;
    }

    /// @notice Registers the P256 public key that may sign a revocation for
    /// `msg.sender` via `revokeWithPasskey`. Independent of whichever account
    /// path (Mera-derived EOA or Privy embedded wallet) holds the funds.
    function registerPasskey(uint256 x, uint256 y) external {
        passkeys[msg.sender] = PassKey(x, y, true);
        emit PasskeyRegistered(msg.sender, x, y);
    }

    /// @notice Creates or replaces an allowance. Only the owner can grant
    /// spending power — there is no path for the assistant, the app or a
    /// backend to grant itself one.
    /// @param id Caller-chosen identifier, stable across the allowance's
    /// life so the UI can revoke and re-query by the same id.
    /// @param delegate The session key executing on the assistant's behalf.
    /// Holds no funds; can only call `execute` within these caveats.
    /// @param recipients The full allow-list this allowance may ever pay.
    /// @param periodSeconds The cadence window. Use a very large value (e.g.
    /// type(uint256).max / 2) for an "on-request" allowance that never
    /// auto-resets and must be revoked and recreated to top up.
    /// @param undoSeconds How long each run waits before it can be carried
    /// out, for the owner to stop it. Zero lets the delegate spend at once.
    function createAllowance(
        bytes32 id,
        address delegate,
        address token,
        address[] calldata recipients,
        uint256 perRunMax,
        uint256 periodCap,
        uint256 periodSeconds,
        uint256 expiresAt,
        uint256 undoSeconds
    ) external {
        if (periodSeconds == 0) revert InvalidPeriod();
        if (undoSeconds > MAX_UNDO_SECONDS) revert UndoTooLong();

        // An id belongs to whoever first creates it. Only that owner may
        // replace it (editing an allowance reuses its id); nobody else can
        // pre-claim or overwrite someone's id, and a replace never inherits
        // the previous allow-list.
        address existing = allowances[id].owner;
        if (existing != address(0)) {
            if (existing != msg.sender) revert IdTaken();
            address[] storage old = _recipientList[id];
            for (uint256 i = 0; i < old.length; i++) {
                recipientAllowed[id][old[i]] = false;
            }
            delete _recipientList[id];
        }

        allowances[id] = Allowance({
            owner: msg.sender,
            delegate: delegate,
            token: token,
            perRunMax: perRunMax,
            periodCap: periodCap,
            periodSeconds: periodSeconds,
            periodStart: block.timestamp,
            spentInPeriod: 0,
            expiresAt: expiresAt,
            revoked: false,
            undoSeconds: undoSeconds
        });
        // Whatever was waiting under the old terms is void, and holds nothing back.
        generation[id]++;
        reserved[id] = 0;

        for (uint256 i = 0; i < recipients.length; i++) {
            recipientAllowed[id][recipients[i]] = true;
            _recipientList[id].push(recipients[i]);
        }

        emit AllowanceCreated(id, msg.sender, delegate);
    }

    /// @notice Revocation is effective immediately: the next `execute` call
    /// against this id reverts, even in the same block if ordered after this
    /// transaction.
    function revoke(bytes32 id) external onlyOwner(id) {
        _revoke(id);
    }

    /// @notice Same effect as `revoke`, authorised by a raw on-chain P256
    /// signature instead of an owner transaction — proves the kill switch
    /// works from a bare passkey signature, not just a session key the app
    /// happens to hold. The signed digest is re-derived on-chain as
    /// keccak256(abi.encode(address(this), block.chainid, id, "revoke")),
    /// so the owner's passkey never has to be told the contract's internals.
    function revokeWithPasskey(bytes32 id, bytes32 r, bytes32 s) external {
        address owner = allowances[id].owner;
        PassKey memory pk = passkeys[owner];
        if (!pk.set) revert BadSignature();

        bytes32 digest = keccak256(abi.encode(address(this), block.chainid, id, "revoke"));
        if (!_verifyP256(digest, r, s, pk.x, pk.y)) revert BadSignature();

        _revoke(id);
    }

    function _revoke(bytes32 id) internal {
        if (allowances[id].revoked) revert AlreadyRevoked();
        allowances[id].revoked = true;
        generation[id]++;
        reserved[id] = 0;
        emit AllowanceRevoked(id, allowances[id].owner);
    }

    /// @notice Pauses or resumes every allowance `msg.sender` owns in one
    /// call. Never buried, never a second confirmation — this function is
    /// the whole feature.
    function setPaused(bool next) external {
        paused[msg.sender] = next;
        emit Paused(msg.sender, next);
    }

    /// @notice Called by an allowance's delegate to spend inside it. Reverts
    /// the instant any caveat is violated — it does not degrade, warn, or
    /// consult anything.
    function execute(bytes32 id, address recipient, uint256 amount) external {
        if (allowances[id].undoSeconds != 0) revert UndoWindowRequired();
        _execute(id, msg.sender, recipient, amount);
    }

    /// @notice Same as `execute`, but the delegate only signs and anyone — in
    /// practice a fee sponsor — submits. The delegate's EIP-712 signature
    /// commits to the allowance, recipient, amount, a one-time nonce and a
    /// deadline, so the submitter can neither redirect nor replay a run. Every
    /// caveat is still checked against the signer, exactly as in `execute`.
    function executeFor(bytes32 id, address recipient, uint256 amount, uint256 deadline, bytes calldata signature)
        external
    {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (allowances[id].undoSeconds != 0) revert UndoWindowRequired();

        address delegate = allowances[id].delegate;
        bytes32 structHash = keccak256(abi.encode(EXECUTE_TYPEHASH, id, recipient, amount, nonces[delegate], deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        if (delegate == address(0) || _recover(digest, signature) != delegate) revert BadSignature();

        nonces[delegate]++;
        _execute(id, delegate, recipient, amount);
    }

    // ── the undo window ──────────────────────────────────────────────

    /// @notice The delegate proposes a run inside an allowance. Every caveat is
    /// checked now, and the amount is held back against the period cap until
    /// the run is carried out or cancelled. Nothing moves yet.
    function propose(bytes32 id, address recipient, uint256 amount) external returns (bytes32 runId) {
        return _propose(id, msg.sender, recipient, amount);
    }

    /// @notice Same as `propose`, signed by the delegate and submitted by
    /// anyone, so the delegate's key needs no fee money of its own.
    function proposeFor(bytes32 id, address recipient, uint256 amount, uint256 deadline, bytes calldata signature)
        external
        returns (bytes32 runId)
    {
        if (block.timestamp > deadline) revert SignatureExpired();
        address delegate = allowances[id].delegate;
        bytes32 structHash = keccak256(abi.encode(PROPOSE_TYPEHASH, id, recipient, amount, nonces[delegate], deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        if (delegate == address(0) || _recover(digest, signature) != delegate) revert BadSignature();
        nonces[delegate]++;
        return _propose(id, delegate, recipient, amount);
    }

    /// @notice Stops a waiting run. The owner or the delegate may, at any time
    /// before it is carried out; anyone may clear one that has gone stale.
    function cancel(bytes32 runId) external {
        _cancel(runId, msg.sender);
    }

    /// @notice Same as `cancel`, signed by the owner or the delegate and
    /// submitted by anyone. Cancelling twice fails, so a signature is good once.
    function cancelFor(bytes32 runId, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 structHash = keccak256(abi.encode(CANCEL_TYPEHASH, runId, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        _cancel(runId, _recover(digest, signature));
    }

    /// @notice Carries out a run whose undo window has passed. Anyone may call
    /// it; every caveat is checked again, so a pause, a revocation or a change
    /// of terms in the meantime stops it.
    function executePending(bytes32 runId) external {
        Run memory run = runs[runId];
        if (run.amount == 0) revert NoSuchRun();
        if (block.timestamp < run.readyAt) revert TooEarly();
        if (block.timestamp > run.expiresAt) revert RunExpired();
        if (run.generation != generation[run.id]) revert RunVoid();

        delete runs[runId];
        reserved[run.id] -= run.amount;
        emit RunCarriedOut(runId, run.id);
        _spend(run.id, run.recipient, run.amount);
    }

    function _propose(bytes32 id, address caller, address recipient, uint256 amount) internal returns (bytes32 runId) {
        Allowance storage a = allowances[id];
        if (a.delegate != caller) revert NotDelegate();
        if (amount == 0) revert OverPerRunMax();
        _checkCaveats(a, id, recipient, amount);

        _rollPeriod(a);
        if (a.spentInPeriod + reserved[id] + amount > a.periodCap) revert OverPeriodCap();
        reserved[id] += amount;

        runId = keccak256(abi.encode(address(this), id, ++_runCount));
        uint256 readyAt = block.timestamp + a.undoSeconds;
        // casting to 'uint64' is safe because a timestamp plus a day fits in 64 bits for billions of years
        // forge-lint: disable-next-line(unsafe-typecast)
        runs[runId] = Run({
            id: id,
            recipient: recipient,
            amount: amount,
            readyAt: uint64(readyAt),
            expiresAt: uint64(readyAt + RUN_WINDOW),
            generation: generation[id]
        });
        emit Proposed(runId, id, recipient, amount, readyAt);
    }

    function _cancel(bytes32 runId, address by) internal {
        Run memory run = runs[runId];
        if (run.amount == 0) revert NoSuchRun();
        Allowance storage a = allowances[run.id];
        bool stale = block.timestamp > run.expiresAt;
        if (by == address(0) || (!stale && by != a.owner && by != a.delegate)) revert NotAllowedToCancel();

        delete runs[runId];
        if (run.generation == generation[run.id]) reserved[run.id] -= run.amount;
        emit Cancelled(runId, run.id);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(DOMAIN_TYPEHASH, keccak256("EntolePolicy"), keccak256("1"), block.chainid, address(this))
            );
    }

    function _execute(bytes32 id, address caller, address recipient, uint256 amount) internal {
        if (allowances[id].delegate != caller) revert NotDelegate();
        _spend(id, recipient, amount);
    }

    /// @dev Every caveat but who is asking: revocation, pause, expiry, the
    /// allow-list and the per-run maximum.
    function _checkCaveats(Allowance storage a, bytes32 id, address recipient, uint256 amount) internal view {
        if (a.revoked) revert AlreadyRevoked();
        if (paused[a.owner]) revert AccountPaused();
        if (block.timestamp > a.expiresAt) revert Expired();
        if (!recipientAllowed[id][recipient]) revert RecipientNotAllowed();
        if (amount > a.perRunMax) revert OverPerRunMax();
    }

    /// @dev The one place money moves: every caveat, the period cap counting
    /// what other runs hold back, then the draw from the owner.
    function _spend(bytes32 id, address recipient, uint256 amount) internal {
        Allowance storage a = allowances[id];
        _checkCaveats(a, id, recipient, amount);

        _rollPeriod(a);
        if (a.spentInPeriod + reserved[id] + amount > a.periodCap) revert OverPeriodCap();
        a.spentInPeriod += amount;

        emit Executed(id, recipient, amount);

        bool ok = IERC20(a.token).transferFrom(a.owner, recipient, amount);
        if (!ok) revert TransferFailed();
    }

    /// @dev 65-byte r‖s‖v only, low-s only, so one authorisation has exactly
    /// one valid encoding. Returns address(0) on anything malformed.
    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }

    function _rollPeriod(Allowance storage a) internal {
        if (block.timestamp < a.periodStart + a.periodSeconds) return;
        uint256 elapsed = block.timestamp - a.periodStart;
        a.periodStart += (elapsed / a.periodSeconds) * a.periodSeconds;
        a.spentInPeriod = 0;
    }

    /// @notice Mirrors `execute`'s arithmetic without spending anything, so
    /// the app can grey out a run it already knows will be refused. The
    /// contract is still the only thing that decides for real.
    function wouldExceed(bytes32 id, address recipient, uint256 amount) external view returns (bool) {
        Allowance memory a = allowances[id];
        if (a.delegate == address(0)) return true;
        if (a.revoked || paused[a.owner]) return true;
        if (block.timestamp > a.expiresAt) return true;
        if (!recipientAllowed[id][recipient]) return true;
        if (amount > a.perRunMax) return true;

        uint256 spent = a.spentInPeriod;
        if (block.timestamp >= a.periodStart + a.periodSeconds) spent = 0;
        return spent + reserved[id] + amount > a.periodCap;
    }

    function _verifyP256(bytes32 digest, bytes32 r, bytes32 s, uint256 x, uint256 y) internal view returns (bool) {
        (bool ok, bytes memory out) = P256_VERIFIER.staticcall(abi.encode(digest, r, s, x, y));
        return ok && out.length == 32 && out[31] == 0x01;
    }
}
