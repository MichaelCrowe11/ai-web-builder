// x402 payer — the buyer side of our own agent API.
//
// This is the counterpart to server/agent/x402-verifier.ts: it does what a paying
// agent does, so we can prove the POSITIVE path end to end (sign → verify → build
// → settle → USDC on chain). Our test suite proves we reject bad payments; only a
// real signed payment proves we ever accept a good one.
//
// FLOW
//   1. Request the endpoint with no payment      → server answers 402 + `accepts`
//   2. Sign an EIP-3009 TransferWithAuthorization over accepts[0]
//   3. Replay the request with `X-PAYMENT: base64(PaymentPayload)`
//
// The payer needs USDC and NOTHING ELSE — no native gas token. EIP-3009 is signed
// off chain and the facilitator broadcasts `transferWithAuthorization` itself, so
// gas is the facilitator's problem, not the buyer's.
//
// USAGE
//   # 1. Make a throwaway payer and print its address (fund this at a faucet)
//   npx tsx script/x402-pay.ts --new-key
//
//   # 2. Pay for a build
//   X402_PAYER_PRIVATE_KEY=0x... npx tsx script/x402-pay.ts \
//     --url http://localhost:8080/v1/agent/sites \
//     --prompt "a landing page for a mushroom farm"
//
//   # Refine an existing site (needs the claim token from the build response)
//   X402_PAYER_PRIVATE_KEY=0x... npx tsx script/x402-pay.ts \
//     --url http://localhost:8080/v1/agent/sites/<id>/refine \
//     --instruction "make the hero headline shorter" --claim-token <token>
//
// FLAGS
//   --new-key           generate a payer key, print key + address, exit
//   --url <url>         endpoint to pay for (required unless --new-key)
//   --prompt <text>     body for a build request
//   --instruction <text> body for a refine request
//   --claim-token <tok> X-Claim-Token header (refine only)
//   --timeout <secs>    signature validity window; overrides the server's
//                       maxTimeoutSeconds. Raise it if a build outlasts the
//                       authorization — settle() runs AFTER the build, so a slow
//                       build can otherwise expire its own payment.
//   --dry-run           print the signed payload and stop before paying

import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

// x402 network identifier → viem chain. Mirrors NETWORK_TOKEN_DEFAULTS in
// server/agent/x402-verifier.ts; both sides must agree on the chain id because
// it is part of the EIP-712 domain the buyer signs.
const CHAINS = { base, "base-sepolia": baseSepolia } as const;

const EXPLORERS: Record<string, string> = {
  base: "https://basescan.org/tx/",
  "base-sepolia": "https://sepolia.basescan.org/tx/",
};

// EIP-3009. The struct the token contract verifies; the field order is part of
// the type hash, so it must match the USDC contract exactly.
const TRANSFER_WITH_AUTHORIZATION = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

interface Accepts {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds?: number;
  extra?: { name: string; version: string };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// A fresh 32-byte nonce per authorization. USDC records spent nonces on chain,
// so reusing one makes the transfer revert as already-used.
function randomNonce(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Buffer.from(b).toString("hex")}` as Hex;
}

async function main() {
  if (has("new-key")) {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    console.log(`payer address:     ${account.address}`);
    console.log(`payer private key: ${key}`);
    console.log(`\nFund the ADDRESS with USDC, then re-run with:`);
    console.log(`  X402_PAYER_PRIVATE_KEY=${key} npx tsx script/x402-pay.ts --url ... --prompt ...`);
    console.log(`\nThrowaway key. Do not reuse it for anything that holds real value.`);
    return;
  }

  const url = arg("url") ?? die("--url is required (or --new-key)");
  const privateKey = process.env.X402_PAYER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) die("X402_PAYER_PRIVATE_KEY is not set — run with --new-key to make one");

  const prompt = arg("prompt");
  const instruction = arg("instruction");
  if (!prompt && !instruction) die("pass --prompt (build) or --instruction (refine)");
  const body = prompt ? { prompt } : { instruction };

  const claimToken = arg("claim-token");
  const baseHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (claimToken) baseHeaders["X-Claim-Token"] = claimToken;

  const account = privateKeyToAccount(privateKey);
  console.log(`payer: ${account.address}`);

  // ── 1. Unpaid request → expect 402 with payment requirements ────────────────
  console.log(`\n[1/3] GET challenge — POST ${url} with no payment`);
  const challengeRes = await fetch(url, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify(body),
  });

  if (challengeRes.status !== 402) {
    const text = await challengeRes.text();
    die(
      `expected HTTP 402, got ${challengeRes.status}. Body: ${text.slice(0, 500)}\n` +
        `(503 payments_unavailable means X402_PAY_TO_ADDRESS / X402_FACILITATOR_URL are unset on the server)`,
    );
  }

  const challenge = await challengeRes.json();
  const accepts: Accepts | undefined = challenge?.accepts?.[0];
  if (!accepts) die(`402 body had no accepts[0]: ${JSON.stringify(challenge)}`);

  const chain = CHAINS[accepts.network as keyof typeof CHAINS];
  if (!chain) die(`unsupported network "${accepts.network}" — expected one of ${Object.keys(CHAINS).join(", ")}`);
  if (!accepts.extra?.name) {
    die(`402 accepts[0] is missing extra.{name,version} (the token EIP-712 domain) — cannot sign`);
  }

  const amount = BigInt(accepts.maxAmountRequired);
  console.log(`      network:  ${accepts.network} (chainId ${chain.id})`);
  console.log(`      asset:    ${accepts.asset}`);
  console.log(`      amount:   ${accepts.maxAmountRequired} atomic (${Number(amount) / 1e6} USDC)`);
  console.log(`      payTo:    ${accepts.payTo}`);
  console.log(`      resource: ${accepts.resource}`);

  // ── 2. Sign the EIP-3009 authorization ──────────────────────────────────────
  // validAfter is backdated to absorb clock skew between us and the chain node.
  // validBefore bounds how long the authorization stays spendable — and because
  // the server settles only AFTER the build succeeds, this window has to outlive
  // the build itself.
  const now = Math.floor(Date.now() / 1000);
  const windowSecs = Number(arg("timeout") ?? accepts.maxTimeoutSeconds ?? 300);
  const authorization = {
    from: account.address,
    to: accepts.payTo as Hex,
    value: amount,
    validAfter: BigInt(now - 600),
    validBefore: BigInt(now + windowSecs),
    nonce: randomNonce(),
  };

  const wallet = createWalletClient({ account, chain, transport: http() });
  const signature = await wallet.signTypedData({
    account,
    domain: {
      name: accepts.extra.name,
      version: accepts.extra.version,
      chainId: chain.id,
      verifyingContract: accepts.asset as Hex,
    },
    types: TRANSFER_WITH_AUTHORIZATION,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  // The wire format expects decimal strings, not BigInt — JSON.stringify throws
  // on BigInt, and the facilitator parses these as strings.
  const paymentPayload = {
    x402Version: 1,
    scheme: accepts.scheme,
    network: accepts.network,
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
  };
  const header = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  console.log(`\n[2/3] signed authorization (valid ${windowSecs}s, expires ${new Date((now + windowSecs) * 1000).toISOString()})`);

  if (has("dry-run")) {
    console.log(JSON.stringify(paymentPayload, null, 2));
    console.log(`\n--dry-run: stopping before payment.`);
    return;
  }

  // ── 3. Replay the request, paid ─────────────────────────────────────────────
  console.log(`[3/3] paying — POST ${url} with X-PAYMENT`);
  const startedAt = Date.now();
  const paidRes = await fetch(url, {
    method: "POST",
    headers: { ...baseHeaders, "X-PAYMENT": header },
    body: JSON.stringify(body),
  });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const text = await paidRes.text();

  if (!paidRes.ok) {
    console.error(`\nFAILED — HTTP ${paidRes.status} after ${elapsed}s`);
    console.error(text.slice(0, 2000));
    if (paidRes.status === 402) {
      console.error(`\n402 on a signed request = the facilitator rejected it. Common causes:`);
      console.error(`  - payer has no USDC on ${accepts.network}`);
      console.error(`  - requirements drift between challenge and verify (APP_URL / price changed mid-flight)`);
    }
    process.exit(1);
  }

  const result = JSON.parse(text);
  console.log(`\nPAID — HTTP ${paidRes.status} in ${elapsed}s`);
  console.log(JSON.stringify(result, null, 2));

  // The server settles after a successful build but does not return the tx hash,
  // so confirm the money on chain rather than trusting the 200.
  console.log(`\nVerify settlement on chain — USDC transfers to ${accepts.payTo}:`);
  console.log(`  ${EXPLORERS[accepts.network] ?? ""}`.replace(/tx\/$/, `address/${accepts.payTo}`));
  if (result.siteUrl) console.log(`\nBuilt site: ${result.siteUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
