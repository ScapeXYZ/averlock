// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST-ONLY token with unrestricted minting for local unit tests.
contract TestERC20 is ERC20 {
    constructor() ERC20("Test FXRP", "tFXRP") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

/// @notice TEST-ONLY fee token used to verify that exact-deposit enforcement rejects transfer fees.
contract FeeOnTransferTestERC20 is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = value / 100;
        super._update(from, to, value - fee);
        super._update(from, address(0), fee);
    }
}
