/**
 * Transfer test SPACE tokens from the minter wallet to any address.
 *
 * Usage:
 *   node scripts/transfer-test-space.js <recipient_pubkey> <amount> [keypair_path]
 * Example (give 10,000 SPACE to your browser wallet):
 *   node scripts/transfer-test-space.js 7Xy...abc 10000
 *
 * Notes:
 *  - SPACE has 9 decimals (1 SPACE = 1_000_000_000 base units).
 *  - The sender's keypair (3rd arg or SOLANA_KEYPAIR_PATH env or ~/.config/solana/id.json)
 *    must own or have mint authority over the SPACE token (the one that ran create-test-space.js).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  transfer,
} = require('@solana/spl-token');

const SPACE_MINT = new PublicKey(
  process.env.SPACE_MINT || 'EHaeA9ke8Gaj9AKdjZ92pvk6oUFSZ5YehaqhAhgqZRZa',
);
const DECIMALS = 9;

function loadKeypair() {
  const keypairArg = process.argv[4];
  if (keypairArg && fs.existsSync(keypairArg)) {
    const data = JSON.parse(fs.readFileSync(keypairArg, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }
  const keypairEnv = process.env.SOLANA_KEYPAIR_PATH;
  if (keypairEnv && fs.existsSync(keypairEnv)) {
    const data = JSON.parse(fs.readFileSync(keypairEnv, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }
  const defaultPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (fs.existsSync(defaultPath)) {
    const data = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }
  console.error('Could not load sender keypair. Pass a path as the 3rd arg or set SOLANA_KEYPAIR_PATH.');
  process.exit(1);
}

async function main() {
  const recipientAddress = process.argv[2];
  const amountHuman = parseFloat(process.argv[3] || '10000');

  if (!recipientAddress) {
    console.error('Usage: node scripts/transfer-test-space.js <recipient_pubkey> <amount> [keypair_path]');
    process.exit(1);
  }

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const payer = loadKeypair();
  const recipient = new PublicKey(recipientAddress);

  console.log(`Sender:    ${payer.publicKey.toBase58()}`);
  console.log(`Recipient: ${recipient.toBase58()}`);
  console.log(`Amount:    ${amountHuman} SPACE`);
  console.log('');

  const senderATA = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    SPACE_MINT,
    payer.publicKey,
  );
  const recipientATA = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    SPACE_MINT,
    recipient,
  );

  const amountUnits = BigInt(Math.floor(amountHuman * Math.pow(10, DECIMALS)));

  const sig = await transfer(
    connection,
    payer,
    senderATA.address,
    recipientATA.address,
    payer,
    amountUnits,
  );

  console.log(`Transferred. tx=${sig}`);
  console.log(`https://solscan.io/tx/${sig}?cluster=devnet`);

  const senderBal = await connection.getTokenAccountBalance(senderATA.address);
  const recipientBal = await connection.getTokenAccountBalance(recipientATA.address);
  console.log('');
  console.log(`Sender balance:    ${senderBal.value.uiAmount} SPACE`);
  console.log(`Recipient balance: ${recipientBal.value.uiAmount} SPACE`);
}

main().catch((e) => {
  console.error('Transfer failed:', e.message || e);
  if (e.logs) e.logs.forEach((l) => console.error(' ', l));
  process.exit(1);
});
