# Setup Keeper from Private Key

You have a private key: `45SDpBQ4GotbDGuctvWV6d28449ad7Js4e1baY1987FQUi9wgzd9hpWgwzxrRYu34iKtH8eubQHVKzZy3BGSYFRx`

## Option 1: Using Solana CLI (Easiest)

1. **Save your private key to a file:**
   ```bash
   echo "45SDpBQ4GotbDGuctvWV6d28449ad7Js4e1baY1987FQUi9wgzd9hpWgwzxrRYu34iKtH8eubQHVKzZy3BGSYFRx" > keeper-keypair.json
   ```

2. **Get the public key:**
   ```bash
   solana address -k keeper-keypair.json
   ```

3. **Convert to array format using Node.js:**
   ```bash
   node -e "const fs=require('fs'); const kp=JSON.parse(fs.readFileSync('keeper-keypair.json')); console.log(JSON.stringify(Array.isArray(kp)?kp:require('@solana/web3.js').Keypair.fromSecretKey(Buffer.from(kp)).secretKey))"
   ```

## Option 2: Using the Conversion Script

1. **Install bs58 (if needed):**
   ```bash
   cd backend
   npm install bs58
   ```

2. **Run the conversion script:**
   ```bash
   node scripts/convert-private-key-to-keeper.js 45SDpBQ4GotbDGuctvWV6d28449ad7Js4e1baY1987FQUi9wgzd9hpWgwzxrRYu34iKtH8eubQHVKzZy3BGSYFRx
   ```

## Option 3: Manual Conversion (Using Solana Web3.js)

Create a file `convert.js`:

```javascript
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const privateKey = '45SDpBQ4GotbDGuctvWV6d28449ad7Js4e1baY1987FQUi9wgzd9hpWgwzxrRYu34iKtH8eubQHVKzZy3BGSYFRx';

// Decode base58
const secretKey = bs58.decode(privateKey);

// Create keypair
const keypair = Keypair.fromSecretKey(secretKey);

// Convert to array
const secretKeyArray = Array.from(secretKey);

console.log('Public Key:', keypair.publicKey.toString());
console.log('');
console.log('KEEPER_KEYPAIR=' + JSON.stringify(secretKeyArray));
```

Run it:
```bash
npm install bs58
node convert.js
```

## After Conversion

1. **Add to your `.env` file:**
   ```
   KEEPER_KEYPAIR='[123,45,67,...]'
   ```

2. **Fund the keeper with SOL:**
   ```bash
   solana transfer <public-key> 0.1
   ```

3. **Restart your backend**




