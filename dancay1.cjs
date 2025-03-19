const { Web3 } = require('web3');
const fs = require('fs');
const colors = require('colors');

const rpcUrl = 'https://evmrpc-testnet.0g.ai';
const web3 = new Web3(rpcUrl);

const mintABI = [
  {
    'inputs': [{ 'internalType': 'address', 'name': '', 'type': 'address' }],
    'name': 'lastClaimed',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'mint',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }
];

const ERC20_ABI = [
  {
    'inputs': [
      { 'internalType': 'address', 'name': 'spender', 'type': 'address' },
      { 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
    ],
    'name': 'approve',
    'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [{ 'internalType': 'address', 'name': '', 'type': 'address' }],
    'name': 'balanceOf',
    'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
    'stateMutability': 'view',
    'type': 'function'
  }
];

const ROUTER_ABI = [
  {
    'inputs': [
      {
        'components': [
          { 'internalType': 'address', 'name': 'tokenIn', 'type': 'address' },
          { 'internalType': 'address', 'name': 'tokenOut', 'type': 'address' },
          { 'internalType': 'uint24', 'name': 'fee', 'type': 'uint24' },
          { 'internalType': 'address', 'name': 'recipient', 'type': 'address' },
          { 'internalType': 'uint256', 'name': 'deadline', 'type': 'uint256' },
          { 'internalType': 'uint256', 'name': 'amountIn', 'type': 'uint256' },
          { 'internalType': 'uint256', 'name': 'amountOutMinimum', 'type': 'uint256' },
          { 'internalType': 'uint160', 'name': 'sqrtPriceLimitX96', 'type': 'uint160' }
        ],
        'internalType': 'struct ISwapRouter.ExactInputSingleParams',
        'name': 'params',
        'type': 'tuple'
      }
    ],
    'name': 'exactInputSingle',
    'outputs': [{ 'internalType': 'uint256', 'name': 'amountOut', 'type': 'uint256' }],
    'stateMutability': 'payable',
    'type': 'function'
  }
];

const contracts = {
  Ethereum: '0xce830D0905e0f7A9b300401729761579c5FB6bd6',
  Bitcoin: '0x1E0D871472973c562650E991ED8006549F8CBEfc',
  Tether: '0x9A87C2412d500343c073E5Ae5394E3bE3874F76b'
};

const SWAP_ROUTER_ADDRESS = '0xd86b764618c6e3c078845be3c3fce50ce9535da7';

function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  switch (type) {
    case 'success':
      console.log(`[${timestamp}] [✓] ${msg}`.green);
      break;
    case 'custom':
      console.log(`[${timestamp}] [*] ${msg}`.magenta);
      break;
    case 'error':
      console.log(`[${timestamp}] [✗] ${msg}`.red);
      break;
    case 'warning':
      console.log(`[${timestamp}] [!] ${msg}`.yellow);
      break;
    default:
      console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
  }
}

function readPrivateKeys() {
    try {
        const data = fs.readFileSync('privatekey1.txt', 'utf8');
        return data.split('\n').map(key => key.trim()).filter(key => key);
    } catch (err) {
        console.log("Gagal membaca privatekey1.txt:", err.message);
        return [];
    }
}


async function canClaimNow(contract, address) {
  try {
    const lastClaimedTimestamp = await contract.methods.lastClaimed(address).call();
    const lastClaimedTimestampNumber = Number(lastClaimedTimestamp);
    const lastClaimedDate = new Date(lastClaimedTimestampNumber * 1000);
    const currentTime = Date.now();
    const timeSinceLastClaim = currentTime - (lastClaimedTimestampNumber * 1000);
    const hoursSinceLastClaim = timeSinceLastClaim / (1000 * 60 * 60);
    const canClaim = hoursSinceLastClaim >= 24;

    log(`Claim gần nhất: ${lastClaimedDate.toLocaleString()} | Có thể claim bây giờ không?: ${canClaim}`);

    if (!canClaim) {
      const nextClaimTime = new Date(lastClaimedDate.getTime() + (24 * 60 * 60 * 1000));
      log(`Thời gian claim tiếp theo: ${nextClaimTime.toLocaleString()}`, 'warning');
    }
    return canClaim;
  } catch (error) {
    log(`Lỗi kiểm tra tính đủ điều kiện để claim: ${error.message}`, 'error');
    if (error.message.includes("execution reverted") || lastClaimedTimestamp === '0') {
      log("Đây là lần claim đầu tiên.", 'custom');
      return true;
    }
    return false;
  }
}

async function approveToken(tokenAddress, amount, account, privateKey) {
  const tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
  const nonce = Number(await web3.eth.getTransactionCount(account.address, 'pending'));
  const gasPrice = Number(await web3.eth.getGasPrice()) * 1.2;

  const tx = {
    from: account.address,
    to: tokenAddress,
    gas: 100000,
    gasPrice: Math.floor(gasPrice),
    data: tokenContract.methods.approve(SWAP_ROUTER_ADDRESS, amount).encodeABI(),
    nonce: nonce,
  };

  const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
  log(`Approved ${web3.utils.fromWei(amount, 'ether')} of token ${tokenAddress} for swapping. Tx Hash: ${receipt.transactionHash}`, 'success');
}

async function swapTokens(tokenIn, tokenOut, amountIn, account, privateKey) {
  const routerContract = new web3.eth.Contract(ROUTER_ABI, SWAP_ROUTER_ADDRESS);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const nonce = Number(await web3.eth.getTransactionCount(account.address, 'pending'));
  const gasPrice = Number(await web3.eth.getGasPrice()) * 1.2;

  const params = {
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: 3000,
    recipient: account.address,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  };

  const tx = {
    from: account.address,
    to: SWAP_ROUTER_ADDRESS,
    gas: 300000,
    gasPrice: Math.floor(gasPrice),
    data: routerContract.methods.exactInputSingle(params).encodeABI(),
    nonce: nonce,
  };

  const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
  log(`Swapped ${web3.utils.fromWei(amountIn, 'ether')} from ${tokenIn} to ${tokenOut}. Tx Hash: ${receipt.transactionHash}`, 'success');
}

async function mintFromContract(privateKey, contractAddress, contractTag) {
  let account;
  
  try {
    account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);
    
    const balance = await web3.eth.getBalance(account.address);
    log(`Số dư ví ${account.address}: ${web3.utils.fromWei(balance, 'ether')} 0G`);
    
    const contract = new web3.eth.Contract(mintABI, contractAddress);
    const eligibleToClaim = await canClaimNow(contract, account.address);
    
    if (!eligibleToClaim) {
      log(`Không thể claim ${contractTag} ngay bây giờ. Vui lòng đợi đến thời gian claim tiếp theo.`, 'warning');
      return;
    }
    
    log(`Bắt đầu mint ${contractTag} token...`, 'custom');
    const nonce = Number(await web3.eth.getTransactionCount(account.address, 'pending'));
    const gasPrice = Number(await web3.eth.getGasPrice()) * 1.2;

    const mintTx = {
      from: account.address,
      to: contractAddress,
      gas: 500000,
      gasPrice: Math.floor(gasPrice),
      data: contract.methods.mint().encodeABI(),
      nonce: nonce,
    };
    
    const signedMintTx = await web3.eth.accounts.signTransaction(mintTx, privateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedMintTx.rawTransaction);
    log(`${contractTag} Mint thành công cho ví ${account.address}. Tx Hash: ${receipt.transactionHash}`, 'success');

  } catch (error) {
    log(`Mint token ${contractTag} không thành công cho ví ${account?.address || 'unknown address'}: ${error.message}`, 'error');
  } finally {
    web3.eth.accounts.wallet.clear();
  }
}

async function checkAndSwapTokens(privateKey) {
  let account;
  
  try {
    account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);

    log(`Kiểm tra số dư và chuẩn bị swap cho ví ${account.address}`, 'custom');

    const usdtContract = new web3.eth.Contract(ERC20_ABI, contracts.Tether);
    const btcContract = new web3.eth.Contract(ERC20_ABI, contracts.Bitcoin);
    const ethContract = new web3.eth.Contract(ERC20_ABI, contracts.Ethereum);

    const usdtBalance = await usdtContract.methods.balanceOf(account.address).call();
    const btcBalance = await btcContract.methods.balanceOf(account.address).call();
    const ethBalance = await ethContract.methods.balanceOf(account.address).call();

    log(`USDT Balance: ${web3.utils.fromWei(usdtBalance, 'ether')}`);
    log(`BTC Balance: ${web3.utils.fromWei(btcBalance, 'ether')}`);
    log(`ETH Balance: ${web3.utils.fromWei(ethBalance, 'ether')}`);

    if (Number(usdtBalance) > 0) {
      const usdtToBtc = BigInt(Math.floor(Number(usdtBalance) * (0.05 + Math.random() * 0.05)));
      const usdtToEth = BigInt(Math.floor(Number(usdtBalance) * (0.05 + Math.random() * 0.05)));

      if (usdtToBtc > 0) {
        log(`Swapping ${web3.utils.fromWei(usdtToBtc, 'ether')} USDT to BTC...`, 'custom');
        await approveToken(contracts.Tether, usdtToBtc, account, privateKey);
        await swapTokens(contracts.Tether, contracts.Bitcoin, usdtToBtc, account, privateKey);
      }

      if (usdtToEth > 0) {
        log(`Swapping ${web3.utils.fromWei(usdtToEth, 'ether')} USDT to ETH...`, 'custom');
        await approveToken(contracts.Tether, usdtToEth, account, privateKey);
        await swapTokens(contracts.Tether, contracts.Ethereum, usdtToEth, account, privateKey);
      }
    }

    const newBtcBalance = await btcContract.methods.balanceOf(account.address).call();
    const newEthBalance = await ethContract.methods.balanceOf(account.address).call();

    if (Number(newBtcBalance) > 0) {
      const btcToUsdt = BigInt(Math.floor(Number(newBtcBalance) * (0.05 + Math.random() * 0.05)));
      if (btcToUsdt > 0) {
        log(`Swapping ${web3.utils.fromWei(btcToUsdt, 'ether')} BTC to USDT...`, 'custom');
        await approveToken(contracts.Bitcoin, btcToUsdt, account, privateKey);
        await swapTokens(contracts.Bitcoin, contracts.Tether, btcToUsdt, account, privateKey);
      }
    }

    if (Number(newEthBalance) > 0) {
      const ethToUsdt = BigInt(Math.floor(Number(newEthBalance) * (0.05 + Math.random() * 0.05)));
      if (ethToUsdt > 0) {
        log(`Swapping ${web3.utils.fromWei(ethToUsdt, 'ether')} ETH to USDT...`, 'custom');
        await approveToken(contracts.Ethereum, ethToUsdt, account, privateKey);
        await swapTokens(contracts.Ethereum, contracts.Tether, ethToUsdt, account, privateKey);
      }
    }

  } catch (error) {
    log(`Error in checkAndSwapTokens for ${account?.address || 'unknown address'}: ${error.message}`, 'error');
  } finally {
    web3.eth.accounts.wallet.clear();
  }
}

async function main() {
  const privateKeys = readPrivateKeys();
  
  if (privateKeys.length === 0) {
    log('Không tìm thấy privatekey trong privatekey1.txt', 'error');
    return;
  }
  
  log(`Tìm thấy ${privateKeys.length} ví`);
  log('====== Dân cày airdrop - Đã sợ thì đừng dùng, đã dùng thì đừng sợ ======', 'custom');
  
  for (const privateKey of privateKeys) {
    for (const [tag, address] of Object.entries(contracts)) {
      await mintFromContract(privateKey, address, tag);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await checkAndSwapTokens(privateKey);
  }
  
  log('Hoàn thành!', 'success');
}

main().catch(error => log(`Lỗi rồi: ${error.message}`, 'error'));
