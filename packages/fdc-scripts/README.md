# FDC Scripts

Phase 4 utilities for creating one disposable XRPL Testnet payment and preparing its FDC request. Secrets are stored only in the gitignored `.env.local`; scripts must print public Testnet data only.

```powershell
npm run xrpl:demo --workspace @averlock/fdc-scripts
```

This package never uses XRP mainnet credentials and does not contain a Coston2 signer.
