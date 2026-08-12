import type { Hex } from "viem";

const knownRequests: Record<string, Hex> = {
  "56ca82b41fd8112bac53ee24db60b27a11a4d5c9b58d75808b485c8435cb19df": "0x3fb3b090c03929865627a1125ec28f84bea63761bde3cb60f323af592d6ca29c",
  "e5fb282252b497fd74eddac2d2d66d93478c2c5575f1be5def861cf9c61d5872": "0x1079984dd49c1be9e26f82b21301cd458b3f6f56c398be4c8d20dc8f0db4a12e",
};

export function knownRequestTransactionForPayment(paymentHash:string){return knownRequests[paymentHash.toLowerCase()];}
